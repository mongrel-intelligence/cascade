/**
 * Unit tests for GitHubProjectsRouterAdapter.
 */

import { describe, expect, it, vi } from 'vitest';
import * as client from '../../../../src/github-projects/client.js';
import { GitHubProjectsRouterAdapter } from '../../../../src/router/adapters/github-projects.js';
import type { RouterProjectConfig } from '../../../../src/router/config.js';
import * as config from '../../../../src/router/config.js';
import * as credentials from '../../../../src/router/platformClients/credentials.js';
import type { TriggerRegistry } from '../../../../src/triggers/registry.js';
import type { TriggerResult } from '../../../../src/types/index.js';

vi.mock('../../../../src/router/platformClients/credentials.js', () => ({
	resolveGitHubProjectsCredentials: vi.fn(),
}));

vi.mock('../../../../src/router/config.js', () => ({
	loadProjectConfig: vi.fn(),
}));

vi.mock('../../../../src/github-projects/client.js', () => ({
	getViewer: vi.fn(),
	// Run the scoped fn directly so getViewer() executes in tests.
	withGitHubProjectsCredentials: vi.fn((_creds: unknown, fn: () => unknown) => fn()),
}));

function makeStatusChangePayload(
	projectNodeId: string,
	contentNodeId: string,
	toStatus: { id: string; name: string },
	fromStatus?: { id: string; name: string },
) {
	return {
		action: 'edited',
		projects_v2_item: {
			id: 123456,
			node_id: contentNodeId,
			project_node_id: projectNodeId,
			content_node_id: contentNodeId,
			content_type: 'Issue',
		},
		changes: {
			field_value: {
				field_node_id: 'PVTSSF_field',
				field_type: 'single_select',
				field_name: 'Status',
				from: fromStatus ?? null,
				to: toStatus,
			},
		},
		sender: { login: 'human-user' },
	};
}

describe('GitHubProjectsRouterAdapter', () => {
	const adapter = new GitHubProjectsRouterAdapter();

	describe('parseWebhook', () => {
		it('parses a status-change webhook payload', async () => {
			const payload = makeStatusChangePayload(
				'PVT_project123',
				'PVTI_item456',
				{ id: 'PVTSSF_inprogress', name: 'In Progress' },
				{ id: 'PVTSSF_todo', name: 'Todo' },
			);

			const event = await adapter.parseWebhook(payload);
			expect(event).toBeTruthy();
			expect(event?.projectIdentifier).toBe('PVT_project123');
			expect(event?.workItemId).toBe('PVTI_item456');
			expect(event?.eventType).toBe('projects_v2_item/edited');
			expect(event?.isCommentEvent).toBe(false);
			expect(event?.statusChange).toEqual({
				from: 'Todo',
				to: 'In Progress',
				fieldId: 'PVTSSF_field',
				fieldName: 'Status',
			});
		});

		it('returns null for non-status field changes', async () => {
			const payload = {
				action: 'edited',
				projects_v2_item: {
					id: 1,
					node_id: 'PVTI_item',
					project_node_id: 'PVT_project',
					content_node_id: 'PVTI_item',
					content_type: 'Issue',
				},
				changes: {
					field_value: {
						field_node_id: 'field_priority',
						field_type: 'single_select',
						field_name: 'Priority',
						from: null,
						to: { id: 'priority_high', name: 'High' },
					},
				},
			};

			const event = await adapter.parseWebhook(payload);
			expect(event).toBeNull();
		});

		it('returns null when required fields are missing', async () => {
			const event = await adapter.parseWebhook({ action: 'edited' });
			expect(event).toBeNull();
		});

		it('forwards an edited event when field_name is absent (GitHub often omits it)', async () => {
			// GitHub's projects_v2_item.edited webhook does not reliably send
			// field_name; the router must forward the event so the trigger can
			// confirm the Status field authoritatively.
			const payload = {
				action: 'edited',
				projects_v2_item: {
					id: 1,
					node_id: 'PVTI_item',
					project_node_id: 'PVT_project',
					content_node_id: 'PVTI_item',
					content_type: 'Issue',
				},
				changes: { field_value: { field_node_id: 'PVTSSF_status', field_type: 'single_select' } },
			};

			const event = await adapter.parseWebhook(payload);
			expect(event).toBeTruthy();
			expect(event?.projectIdentifier).toBe('PVT_project');
		});

		it('returns null for an edited event with no field-value change', async () => {
			const event = await adapter.parseWebhook({
				action: 'edited',
				projects_v2_item: {
					id: 1,
					node_id: 'PVTI_item',
					project_node_id: 'PVT_project',
					content_node_id: 'PVTI_item',
					content_type: 'Issue',
				},
				changes: {},
			});
			expect(event).toBeNull();
		});
	});

	describe('isProcessableEvent', () => {
		it('accepts projects_v2_item events', async () => {
			const event = await adapter.parseWebhook(
				makeStatusChangePayload('PVT_p', 'PVTI_i', { id: 's', name: 'Todo' }),
			);
			if (!event) throw new Error('expected event');
			expect(adapter.isProcessableEvent(event)).toBe(true);
		});
	});

	describe('dispatchWithCredentials', () => {
		it('returns null when project credentials are missing', async () => {
			vi.mocked(config.loadProjectConfig).mockResolvedValue({
				projects: [],
				fullProjects: [],
			});
			vi.mocked(credentials.resolveGitHubProjectsCredentials).mockResolvedValue(null);

			const project = { id: 'proj-1' } as RouterProjectConfig;
			const registry = { dispatch: vi.fn() } as unknown as TriggerRegistry;
			const event = await adapter.parseWebhook(
				makeStatusChangePayload('PVT_p', 'PVTI_i', { id: 's', name: 'Todo' }),
			);
			if (!event) throw new Error('expected event');

			const result = await adapter.dispatchWithCredentials(event, {}, project, registry);
			expect(result).toBeNull();
		});
	});

	describe('isSelfAuthored', () => {
		// Maps the GitHub project node id (PVT_…) → CASCADE project id, so viewer
		// resolution keys on the CASCADE id, not the node id. Regression guard for
		// the loop-prevention bug where isSelfAuthored passed the node id to
		// credential resolution and always returned false.
		function stubProjectLookup(nodeId: string, cascadeId: string) {
			vi.mocked(config.loadProjectConfig).mockResolvedValue({
				projects: [{ id: cascadeId, githubProjects: { projectId: nodeId } }],
				fullProjects: [],
			} as unknown as Awaited<ReturnType<typeof config.loadProjectConfig>>);
		}

		it('resolves the viewer via the CASCADE project id (not the GitHub node id)', async () => {
			stubProjectLookup('PVT_project123', 'cascade-proj');
			vi.mocked(credentials.resolveGitHubProjectsCredentials).mockResolvedValue({
				token: 'ghp_x',
			});
			vi.mocked(client.getViewer).mockResolvedValue({ login: 'cascade-bot' } as never);

			const event = await adapter.parseWebhook(
				makeStatusChangePayload('PVT_project123', 'PVTI_i', { id: 's', name: 'Todo' }),
			);
			if (!event) throw new Error('expected event');
			const payload = { sender: { login: 'cascade-bot' } };

			const result = await adapter.isSelfAuthored(event, payload);

			expect(result).toBe(true);
			// The credential lookup must receive the CASCADE id, never the PVT_ node id.
			expect(credentials.resolveGitHubProjectsCredentials).toHaveBeenCalledWith('cascade-proj');
			expect(credentials.resolveGitHubProjectsCredentials).not.toHaveBeenCalledWith(
				'PVT_project123',
			);
		});

		it('returns false when the sender is a different login', async () => {
			stubProjectLookup('PVT_project123', 'cascade-proj');
			vi.mocked(credentials.resolveGitHubProjectsCredentials).mockResolvedValue({
				token: 'ghp_x',
			});
			vi.mocked(client.getViewer).mockResolvedValue({ login: 'cascade-bot' } as never);

			const event = await adapter.parseWebhook(
				makeStatusChangePayload('PVT_project123', 'PVTI_i', { id: 's', name: 'Todo' }),
			);
			if (!event) throw new Error('expected event');

			const result = await adapter.isSelfAuthored(event, { sender: { login: 'human-user' } });
			expect(result).toBe(false);
		});

		it('returns false when no CASCADE project matches the node id', async () => {
			stubProjectLookup('PVT_other', 'cascade-proj');

			const event = await adapter.parseWebhook(
				makeStatusChangePayload('PVT_project123', 'PVTI_i', { id: 's', name: 'Todo' }),
			);
			if (!event) throw new Error('expected event');

			const result = await adapter.isSelfAuthored(event, { sender: { login: 'cascade-bot' } });
			expect(result).toBe(false);
		});
	});

	describe('buildJob', () => {
		it('builds a github-projects job', async () => {
			const event = await adapter.parseWebhook(
				makeStatusChangePayload('PVT_p', 'PVTI_i', { id: 's', name: 'Todo' }),
			);
			if (!event) throw new Error('expected event');
			const project = { id: 'proj-1' } as RouterProjectConfig;
			const result: TriggerResult = {
				shouldDispatch: true,
				agentType: 'implementation',
				workItemId: 'PVTI_i',
			};

			const job = adapter.buildJob(event, {}, project, result, {
				commentId: 'comment-1',
				message: 'ack',
			});

			expect(job.type).toBe('github-projects');
			expect(job.projectId).toBe('proj-1');
			expect(job.workItemId).toBe('PVTI_i');
			expect(job.ackCommentId).toBe('comment-1');
		});
	});
});

/**
 * Unit tests for GitHubProjectsRouterAdapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../../../src/github-projects/client.js';
import * as ackMessageGenerator from '../../../../src/router/ackMessageGenerator.js';
import * as sharedAdapter from '../../../../src/router/adapters/_shared.js';
import { GitHubProjectsRouterAdapter } from '../../../../src/router/adapters/github-projects.js';
import type { RouterProjectConfig } from '../../../../src/router/config.js';
import * as config from '../../../../src/router/config.js';
import * as credentials from '../../../../src/router/platformClients/credentials.js';
import type { TriggerRegistry } from '../../../../src/triggers/registry.js';
import type { TriggerResult } from '../../../../src/types/index.js';
import * as runLink from '../../../../src/utils/runLink.js';

vi.mock('../../../../src/router/platformClients/credentials.js', () => ({
	resolveGitHubProjectsCredentials: vi.fn(),
}));

vi.mock('../../../../src/router/config.js', () => ({
	loadProjectConfig: vi.fn(),
}));

vi.mock('../../../../src/github-projects/client.js', () => ({
	getViewer: vi.fn(),
	addCommentToIssue: vi.fn(),
	// Run the scoped fn directly so getViewer() executes in tests.
	withGitHubProjectsCredentials: vi.fn((_creds: unknown, fn: () => unknown) => fn()),
}));

// Spec 017 / plan 2: PM router adapters wrap dispatch in `withPMScopeForDispatch`.
// Mock as passthrough so dispatch tests don't pull the real PM manifest registry.
vi.mock('../../../../src/router/adapters/_shared.js', () => ({
	withPMScopeForDispatch: vi.fn().mockImplementation((_p: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../../../../src/router/ackMessageGenerator.js', () => ({
	extractGitHubProjectsContext: vi.fn().mockReturnValue('Item: Issue'),
	generateAckMessage: vi.fn().mockResolvedValue('Starting implementation...'),
}));

vi.mock('../../../../src/utils/runLink.js', () => ({
	buildWorkItemRunsLink: vi.fn().mockReturnValue(null),
	getDashboardUrl: vi.fn().mockReturnValue(null),
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

		it('returns null when project_node_id is missing', async () => {
			const event = await adapter.parseWebhook({
				action: 'edited',
				projects_v2_item: {
					id: 1,
					node_id: 'PVTI_item',
					project_node_id: '',
					content_node_id: 'PVTI_item',
					content_type: 'Issue',
				},
				changes: {
					field_value: {
						field_node_id: 'f',
						field_name: 'Status',
						to: { id: 'x', name: 'Done' },
					},
				},
			});
			expect(event).toBeNull();
		});

		it('returns null when content_node_id is missing', async () => {
			const event = await adapter.parseWebhook({
				action: 'edited',
				projects_v2_item: {
					id: 1,
					node_id: 'PVTI_item',
					project_node_id: 'PVT_project',
					content_node_id: '',
					content_type: 'Issue',
				},
				changes: {
					field_value: {
						field_node_id: 'f',
						field_name: 'Status',
						to: { id: 'x', name: 'Done' },
					},
				},
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

		it('rejects events from other webhook types', () => {
			expect(
				adapter.isProcessableEvent({
					projectIdentifier: 'x',
					eventType: 'issue/opened',
					isCommentEvent: false,
				}),
			).toBe(false);
		});
	});

	describe('sendReaction', () => {
		it('is a no-op — GitHub Projects item webhooks have no reaction support', () => {
			expect(() =>
				adapter.sendReaction(
					{ projectIdentifier: 'x', eventType: 'projects_v2_item/edited', isCommentEvent: false },
					{},
				),
			).not.toThrow();
		});
	});

	describe('resolveProject', () => {
		it('returns the matching project config by GitHub Projects node id', async () => {
			vi.mocked(config.loadProjectConfig).mockResolvedValue({
				projects: [{ id: 'cascade-proj', githubProjects: { projectId: 'PVT_abc' } }],
				fullProjects: [],
			} as unknown as Awaited<ReturnType<typeof config.loadProjectConfig>>);

			const event = await adapter.parseWebhook(
				makeStatusChangePayload('PVT_abc', 'PVTI_i', { id: 's', name: 'Todo' }),
			);
			if (!event) throw new Error('expected event');

			const project = await adapter.resolveProject(event);
			expect(project?.id).toBe('cascade-proj');
		});

		it('returns null when no project matches the node id', async () => {
			vi.mocked(config.loadProjectConfig).mockResolvedValue({
				projects: [{ id: 'cascade-proj', githubProjects: { projectId: 'PVT_other' } }],
				fullProjects: [],
			} as unknown as Awaited<ReturnType<typeof config.loadProjectConfig>>);

			const event = await adapter.parseWebhook(
				makeStatusChangePayload('PVT_abc', 'PVTI_i', { id: 's', name: 'Todo' }),
			);
			if (!event) throw new Error('expected event');

			const project = await adapter.resolveProject(event);
			expect(project).toBeNull();
		});
	});

	describe('dispatchWithCredentials', () => {
		it('returns null when no full project config is found (no credential lookup)', async () => {
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
			expect(credentials.resolveGitHubProjectsCredentials).not.toHaveBeenCalled();
		});

		it('returns null when GitHub Projects credentials are missing for a resolved full project', async () => {
			vi.mocked(config.loadProjectConfig).mockResolvedValue({
				projects: [],
				fullProjects: [{ id: 'proj-1', repo: 'owner/repo' } as never],
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
			expect(registry.dispatch).not.toHaveBeenCalled();
		});

		it('dispatches through PM scope and credential scope on the happy path', async () => {
			const fullProject = { id: 'proj-1', repo: 'owner/repo' };
			vi.mocked(config.loadProjectConfig).mockResolvedValue({
				projects: [],
				fullProjects: [fullProject as never],
			});
			vi.mocked(credentials.resolveGitHubProjectsCredentials).mockResolvedValue({
				token: 'ghp_x',
			});
			const triggerResult: TriggerResult = {
				shouldDispatch: true,
				agentType: 'implementation',
				workItemId: 'PVTI_i',
			};
			const dispatch = vi.fn().mockResolvedValue(triggerResult);
			const registry = { dispatch } as unknown as TriggerRegistry;

			const project = { id: 'proj-1' } as RouterProjectConfig;
			const payload = makeStatusChangePayload('PVT_p', 'PVTI_i', { id: 's', name: 'Todo' });
			const event = await adapter.parseWebhook(payload);
			if (!event) throw new Error('expected event');

			const result = await adapter.dispatchWithCredentials(event, payload, project, registry);

			expect(result).toEqual(triggerResult);
			expect(dispatch).toHaveBeenCalledWith({
				project: fullProject,
				source: 'github-projects',
				payload,
			});
			expect(sharedAdapter.withPMScopeForDispatch).toHaveBeenCalledWith(
				fullProject,
				expect.any(Function),
			);
			expect(client.withGitHubProjectsCredentials).toHaveBeenCalledWith(
				{ token: 'ghp_x' },
				expect.any(Function),
			);
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

		it('returns false immediately when the event has no projectId', async () => {
			const event = await adapter.parseWebhook(
				makeStatusChangePayload('PVT_project123', 'PVTI_i', { id: 's', name: 'Todo' }),
			);
			if (!event) throw new Error('expected event');

			const result = await adapter.isSelfAuthored(
				{ ...event, projectId: '' },
				{ sender: { login: 'cascade-bot' } },
			);
			expect(result).toBe(false);
			expect(config.loadProjectConfig).not.toHaveBeenCalled();
		});

		it('returns false when the payload has no sender', async () => {
			stubProjectLookup('PVT_project123', 'cascade-proj');

			const event = await adapter.parseWebhook(
				makeStatusChangePayload('PVT_project123', 'PVTI_i', { id: 's', name: 'Todo' }),
			);
			if (!event) throw new Error('expected event');

			const result = await adapter.isSelfAuthored(event, {});
			expect(result).toBe(false);
		});

		it('returns false when credentials cannot be resolved for the viewer lookup', async () => {
			stubProjectLookup('PVT_project123', 'cascade-proj');
			vi.mocked(credentials.resolveGitHubProjectsCredentials).mockResolvedValue(null);

			const event = await adapter.parseWebhook(
				makeStatusChangePayload('PVT_project123', 'PVTI_i', { id: 's', name: 'Todo' }),
			);
			if (!event) throw new Error('expected event');

			const result = await adapter.isSelfAuthored(event, { sender: { login: 'cascade-bot' } });
			expect(result).toBe(false);
		});

		it('returns false when the viewer lookup throws', async () => {
			stubProjectLookup('PVT_project123', 'cascade-proj');
			vi.mocked(credentials.resolveGitHubProjectsCredentials).mockResolvedValue({
				token: 'ghp_x',
			});
			vi.mocked(client.getViewer).mockRejectedValue(new Error('GraphQL error'));

			const event = await adapter.parseWebhook(
				makeStatusChangePayload('PVT_project123', 'PVTI_i', { id: 's', name: 'Todo' }),
			);
			if (!event) throw new Error('expected event');

			const result = await adapter.isSelfAuthored(event, { sender: { login: 'cascade-bot' } });
			expect(result).toBe(false);
		});
	});

	describe('postAck', () => {
		const baseProject = { id: 'proj-1' } as RouterProjectConfig;
		const baseEvent = {
			projectIdentifier: 'PVT_p',
			eventType: 'projects_v2_item/edited',
			workItemId: 'PVTI_i',
			isCommentEvent: false,
		};

		beforeEach(() => {
			vi.mocked(config.loadProjectConfig).mockResolvedValue({
				projects: [],
				fullProjects: [{ id: 'proj-1' } as never],
			});
			vi.mocked(credentials.resolveGitHubProjectsCredentials).mockResolvedValue({
				token: 'ghp_x',
			});
		});

		it('returns undefined when the event has no workItemId', async () => {
			const ackResult = await adapter.postAck(
				{ ...baseEvent, workItemId: undefined },
				{},
				baseProject,
				'implementation',
			);
			expect(ackResult).toBeUndefined();
			expect(client.addCommentToIssue).not.toHaveBeenCalled();
		});

		it('posts an ack comment and returns commentId + message', async () => {
			vi.mocked(client.addCommentToIssue).mockResolvedValue('comment-1');

			const ackResult = await adapter.postAck(baseEvent, {}, baseProject, 'implementation');

			expect(ackResult?.commentId).toBe('comment-1');
			expect(ackResult?.message).toBe('Starting implementation...');
			expect(client.addCommentToIssue).toHaveBeenCalledWith('PVTI_i', 'Starting implementation...');
		});

		it('skips the ack when PM posting is disabled for the resolved update channel', async () => {
			vi.mocked(config.loadProjectConfig).mockResolvedValue({
				projects: [],
				fullProjects: [
					{ id: 'proj-1', agentUpdateChannels: { implementation: 'scm-only' } } as never,
				],
			});

			const ackResult = await adapter.postAck(baseEvent, {}, baseProject, 'implementation');

			expect(ackResult).toBeUndefined();
			expect(client.addCommentToIssue).not.toHaveBeenCalled();
		});

		it('appends a run-link footer when runLinksEnabled and a dashboard URL is available', async () => {
			vi.mocked(config.loadProjectConfig).mockResolvedValue({
				projects: [],
				fullProjects: [{ id: 'proj-1', runLinksEnabled: true } as never],
			});
			vi.mocked(runLink.getDashboardUrl).mockReturnValue('https://dashboard.example.com');
			vi.mocked(runLink.buildWorkItemRunsLink).mockReturnValue(
				'\n[View runs](https://dashboard.example.com/runs)',
			);
			vi.mocked(client.addCommentToIssue).mockResolvedValue('comment-2');

			const ackResult = await adapter.postAck(baseEvent, {}, baseProject, 'implementation');

			expect(runLink.buildWorkItemRunsLink).toHaveBeenCalledWith({
				dashboardUrl: 'https://dashboard.example.com',
				projectId: 'proj-1',
				workItemId: 'PVTI_i',
			});
			expect(ackResult?.message).toContain('[View runs]');
		});

		it('returns undefined when GitHub Projects credentials cannot be resolved', async () => {
			vi.mocked(credentials.resolveGitHubProjectsCredentials).mockResolvedValue(null);

			const ackResult = await adapter.postAck(baseEvent, {}, baseProject, 'implementation');

			expect(ackResult).toBeUndefined();
			expect(client.addCommentToIssue).not.toHaveBeenCalled();
		});

		it('catches errors from addCommentToIssue and returns undefined', async () => {
			vi.mocked(client.addCommentToIssue).mockRejectedValue(new Error('GraphQL failure'));

			const ackResult = await adapter.postAck(baseEvent, {}, baseProject, 'implementation');

			expect(ackResult).toBeUndefined();
		});

		it('uses extractGitHubProjectsContext + generateAckMessage to build the ack message', async () => {
			vi.mocked(client.addCommentToIssue).mockResolvedValue('comment-3');
			const payload = { projects_v2_item: { content_type: 'Issue' } };

			await adapter.postAck(baseEvent, payload, baseProject, 'implementation');

			expect(ackMessageGenerator.extractGitHubProjectsContext).toHaveBeenCalledWith(payload);
			expect(ackMessageGenerator.generateAckMessage).toHaveBeenCalledWith(
				'implementation',
				'Item: Issue',
				'proj-1',
			);
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

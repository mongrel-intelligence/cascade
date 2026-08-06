import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/utils/logging.js', () => ({ logger: mockLogger }));

vi.mock('../../../../src/router/config.js', () => ({
	loadProjectConfig: vi.fn(),
}));

vi.mock('../../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn(),
}));

vi.mock('../../../../src/gitlab/personas.js', () => ({
	resolvePersonaIdentities: vi
		.fn()
		.mockResolvedValue({ implementer: 'cascade-impl', reviewer: 'cascade-reviewer' }),
	isCascadeBot: vi.fn(
		(username: string, identities: { implementer: string; reviewer: string }) =>
			username === identities.implementer || username === identities.reviewer,
	),
}));

vi.mock('../../../../src/gitlab/client.js', () => ({
	withGitLabToken: vi.fn().mockImplementation((_token: string, fn: () => unknown) => fn()),
}));

vi.mock('../../../../src/pm/context.js', () => ({
	withPMProvider: vi.fn().mockImplementation((_p: unknown, fn: () => unknown) => fn()),
	withPMCredentials: vi
		.fn()
		.mockImplementation((_id: unknown, _type: unknown, _get: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../../../../src/pm/registry.js', () => ({
	pmRegistry: {
		getOrNull: vi.fn().mockReturnValue(null),
		createProvider: vi.fn().mockReturnValue({}),
		register: vi.fn(),
	},
}));

vi.mock('../../../../src/router/platformClients/gitlab.js', () => ({
	GitLabPlatformClient: vi.fn().mockImplementation(() => ({
		postComment: vi.fn().mockResolvedValue(999),
	})),
}));

import { getIntegrationCredential } from '../../../../src/config/provider.js';
import {
	GitLabRouterAdapter,
	injectGitLabEventType,
} from '../../../../src/router/adapters/gitlab.js';
import type { RouterProjectConfig } from '../../../../src/router/config.js';
import { loadProjectConfig } from '../../../../src/router/config.js';
import type { TriggerRegistry } from '../../../../src/triggers/registry.js';

const mockProject: RouterProjectConfig = {
	id: 'p1',
	repo: 'group/repo',
	pmType: 'trello',
};

const mockTriggerRegistry = {
	dispatch: vi.fn().mockResolvedValue(null),
} as unknown as TriggerRegistry;

beforeEach(() => {
	vi.mocked(loadProjectConfig).mockResolvedValue({
		projects: [mockProject],
		fullProjects: [{ id: 'p1', repo: 'group/repo', pm: { type: 'trello' } } as never],
	});
	vi.mocked(getIntegrationCredential).mockResolvedValue('glpat-mock-token');
});

// ---------------------------------------------------------------------------
// injectGitLabEventType
// ---------------------------------------------------------------------------

describe('injectGitLabEventType', () => {
	it('injects _eventType into payload', () => {
		const result = injectGitLabEventType({ object_kind: 'merge_request' }, 'Merge Request Hook');
		expect(result._eventType).toBe('Merge Request Hook');
		expect(result.object_kind).toBe('merge_request');
	});
});

// ---------------------------------------------------------------------------
// GitLabRouterAdapter
// ---------------------------------------------------------------------------

describe('GitLabRouterAdapter', () => {
	let adapter: GitLabRouterAdapter;

	beforeEach(() => {
		adapter = new GitLabRouterAdapter();
	});

	// ======================================================================
	// parseWebhook
	// ======================================================================

	describe('parseWebhook', () => {
		it('returns null for non-processable events', async () => {
			const payload = injectGitLabEventType(
				{ project: { path_with_namespace: 'group/repo' } },
				'Push Hook',
			);
			// Push Hook is processable, so test with something unknown
			const result = await adapter.parseWebhook(
				injectGitLabEventType({ project: { path_with_namespace: 'group/repo' } }, 'Tag Push Hook'),
			);
			expect(result).toBeNull();
		});

		it('returns parsed event for Merge Request Hook', async () => {
			const payload = injectGitLabEventType(
				{
					object_kind: 'merge_request',
					project: { path_with_namespace: 'group/repo', id: 1 },
					object_attributes: { iid: 42, action: 'open' },
				},
				'Merge Request Hook',
			);
			const result = await adapter.parseWebhook(payload);

			expect(result).not.toBeNull();
			expect(result!.eventType).toBe('Merge Request Hook');
			expect(result!.projectIdentifier).toBe('group/repo');
			expect(result!.workItemId).toBe('42');
			expect(result!.isCommentEvent).toBe(false);
		});

		it('returns parsed event for Note Hook with MR', async () => {
			const payload = injectGitLabEventType(
				{
					object_kind: 'note',
					project: { path_with_namespace: 'group/repo', id: 1 },
					object_attributes: { id: 200, note: 'comment' },
					merge_request: { iid: 42 },
				},
				'Note Hook',
			);
			const result = await adapter.parseWebhook(payload);

			expect(result).not.toBeNull();
			expect(result!.eventType).toBe('Note Hook');
			expect(result!.isCommentEvent).toBe(true);
			expect(result!.workItemId).toBe('42');
		});

		it('returns parsed event for Pipeline Hook with MR', async () => {
			const payload = injectGitLabEventType(
				{
					object_kind: 'pipeline',
					project: { path_with_namespace: 'group/repo', id: 1 },
					object_attributes: { id: 100, status: 'success', ref: 'main', sha: 'a', stages: [] },
					merge_request: { iid: 55 },
				},
				'Pipeline Hook',
			);
			const result = await adapter.parseWebhook(payload);

			expect(result).not.toBeNull();
			expect(result!.eventType).toBe('Pipeline Hook');
			expect(result!.workItemId).toBe('55');
		});

		it('returns parsed event for Pipeline Hook without MR', async () => {
			const payload = injectGitLabEventType(
				{
					object_kind: 'pipeline',
					project: { path_with_namespace: 'group/repo', id: 1 },
					object_attributes: { id: 100, status: 'success', ref: 'main', sha: 'a', stages: [] },
				},
				'Pipeline Hook',
			);
			const result = await adapter.parseWebhook(payload);

			expect(result).not.toBeNull();
			expect(result!.workItemId).toBeUndefined();
		});

		it('extracts project path correctly', async () => {
			const payload = injectGitLabEventType(
				{
					object_kind: 'merge_request',
					project: { path_with_namespace: 'my-org/sub-group/my-repo', id: 1 },
					object_attributes: { iid: 1, action: 'open' },
				},
				'Merge Request Hook',
			);
			const result = await adapter.parseWebhook(payload);
			expect(result!.projectIdentifier).toBe('my-org/sub-group/my-repo');
		});
	});

	// ======================================================================
	// isProcessableEvent
	// ======================================================================

	describe('isProcessableEvent', () => {
		it('returns true for Merge Request Hook', () => {
			expect(
				adapter.isProcessableEvent({
					projectIdentifier: 'group/repo',
					eventType: 'Merge Request Hook',
					isCommentEvent: false,
				}),
			).toBe(true);
		});

		it('returns true for Note Hook', () => {
			expect(
				adapter.isProcessableEvent({
					projectIdentifier: 'group/repo',
					eventType: 'Note Hook',
					isCommentEvent: true,
				}),
			).toBe(true);
		});

		it('returns true for Pipeline Hook', () => {
			expect(
				adapter.isProcessableEvent({
					projectIdentifier: 'group/repo',
					eventType: 'Pipeline Hook',
					isCommentEvent: false,
				}),
			).toBe(true);
		});

		it('returns true for Push Hook', () => {
			expect(
				adapter.isProcessableEvent({
					projectIdentifier: 'group/repo',
					eventType: 'Push Hook',
					isCommentEvent: false,
				}),
			).toBe(true);
		});

		it('returns false for unknown event', () => {
			expect(
				adapter.isProcessableEvent({
					projectIdentifier: 'group/repo',
					eventType: 'Tag Push Hook',
					isCommentEvent: false,
				}),
			).toBe(false);
		});
	});

	// ======================================================================
	// isSelfAuthored
	// ======================================================================

	describe('isSelfAuthored', () => {
		it('returns false for non-comment events', async () => {
			const result = await adapter.isSelfAuthored(
				{ projectIdentifier: 'group/repo', eventType: 'Merge Request Hook', isCommentEvent: false },
				{},
			);
			expect(result).toBe(false);
		});

		it('returns true when the note author is a CASCADE persona (loop prevention)', async () => {
			const result = await adapter.isSelfAuthored(
				{
					projectIdentifier: 'group/repo',
					eventType: 'Note Hook',
					isCommentEvent: true,
					projectPath: 'group/repo',
				} as never,
				{ user: { username: 'cascade-impl' } },
			);
			expect(result).toBe(true);
		});

		it('returns false when the note author is a human (not a CASCADE persona)', async () => {
			const result = await adapter.isSelfAuthored(
				{
					projectIdentifier: 'group/repo',
					eventType: 'Note Hook',
					isCommentEvent: true,
					projectPath: 'group/repo',
				} as never,
				{ user: { username: 'human-dev' } },
			);
			expect(result).toBe(false);
		});

		it('returns false when the payload has no note author', async () => {
			const result = await adapter.isSelfAuthored(
				{
					projectIdentifier: 'group/repo',
					eventType: 'Note Hook',
					isCommentEvent: true,
					projectPath: 'group/repo',
				} as never,
				{},
			);
			expect(result).toBe(false);
		});

		it('returns false when no project matches the path', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValueOnce({
				projects: [],
				fullProjects: [],
			} as never);
			const result = await adapter.isSelfAuthored(
				{
					projectIdentifier: 'group/other',
					eventType: 'Note Hook',
					isCommentEvent: true,
					projectPath: 'group/other',
				} as never,
				{ user: { username: 'cascade-impl' } },
			);
			expect(result).toBe(false);
		});
	});

	// ======================================================================
	// resolveProject
	// ======================================================================

	describe('resolveProject', () => {
		it('resolves project by GitLab project path', async () => {
			const event = {
				projectIdentifier: 'group/repo',
				eventType: 'Merge Request Hook',
				isCommentEvent: false,
				projectPath: 'group/repo',
			};

			const result = await adapter.resolveProject(event);
			expect(result).toEqual(mockProject);
		});

		it('returns null when no project matches', async () => {
			const event = {
				projectIdentifier: 'other/repo',
				eventType: 'Merge Request Hook',
				isCommentEvent: false,
				projectPath: 'other/repo',
			};

			const result = await adapter.resolveProject(event);
			expect(result).toBeNull();
		});
	});

	// ======================================================================
	// buildJob
	// ======================================================================

	describe('buildJob', () => {
		it('builds a GitLab job with correct structure', () => {
			const event = {
				projectIdentifier: 'group/repo',
				eventType: 'Merge Request Hook',
				isCommentEvent: false,
				projectPath: 'group/repo',
			};
			const payload = { object_kind: 'merge_request' };
			const triggerResult = {
				agentType: 'review',
				agentInput: { prNumber: 42 },
				prNumber: 42,
			};
			const ackResult = { commentId: 999, message: 'Processing...' };

			const job = adapter.buildJob(event, payload, mockProject, triggerResult, ackResult);

			expect(job.type).toBe('gitlab');
			expect(job.source).toBe('gitlab');
			expect(job.eventType).toBe('Merge Request Hook');
			expect(job.triggerResult).toEqual(triggerResult);
			expect((job as { ackCommentId?: number }).ackCommentId).toBe(999);
			expect((job as { ackMessage?: string }).ackMessage).toBe('Processing...');
		});
	});
});

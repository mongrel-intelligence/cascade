import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../../src/router/config.js', () => ({
	loadProjectConfig: vi.fn(),
}));
vi.mock('../../../../src/router/queue.js', () => ({
	addJob: vi.fn(),
}));
vi.mock('../../../../src/router/acknowledgments.js', () => ({
	postLinearAck: vi.fn(),
}));
vi.mock('../../../../src/router/ackMessageGenerator.js', () => ({
	extractLinearContext: vi.fn().mockReturnValue('Issue: Fix the bug'),
	generateAckMessage: vi.fn().mockResolvedValue('Working on it...'),
}));
vi.mock('../../../../src/router/platformClients/index.js', () => ({
	resolveLinearCredentials: vi.fn().mockResolvedValue({
		apiKey: 'lin_api_test',
	}),
}));
vi.mock('../../../../src/utils/runLink.js', () => ({
	buildWorkItemRunsLink: vi.fn().mockReturnValue(null),
	getDashboardUrl: vi.fn().mockReturnValue(null),
}));
vi.mock('../../../../src/linear/client.js', () => ({
	withLinearCredentials: vi.fn().mockImplementation((_creds: unknown, fn: () => unknown) => fn()),
}));

import { postLinearAck } from '../../../../src/router/acknowledgments.js';
import { LinearRouterAdapter } from '../../../../src/router/adapters/linear.js';
import type { RouterProjectConfig } from '../../../../src/router/config.js';
import { loadProjectConfig } from '../../../../src/router/config.js';
import { resolveLinearCredentials } from '../../../../src/router/platformClients/index.js';
import type { TriggerRegistry } from '../../../../src/triggers/registry.js';
import { buildWorkItemRunsLink, getDashboardUrl } from '../../../../src/utils/runLink.js';

const mockProject: RouterProjectConfig = {
	id: 'p1',
	repo: 'owner/repo',
	pmType: 'linear',
	linear: {
		teamId: 'team-abc-123',
	},
};

const mockTriggerRegistry = {
	dispatch: vi.fn().mockResolvedValue(null),
} as unknown as TriggerRegistry;

beforeEach(() => {
	vi.mocked(loadProjectConfig).mockResolvedValue({
		projects: [mockProject],
		fullProjects: [{ id: 'p1' } as never],
	});
});

const baseLinearPayload = {
	action: 'create',
	type: 'Issue',
	organizationId: 'org-123',
	webhookTimestamp: Date.now(),
	data: {
		id: 'issue-abc',
		title: 'Fix the bug',
		teamId: 'team-abc-123',
	},
	url: 'https://linear.app/team/issue/TEAM-1',
};

describe('LinearRouterAdapter', () => {
	let adapter: LinearRouterAdapter;

	beforeEach(() => {
		adapter = new LinearRouterAdapter();
	});

	describe('parseWebhook', () => {
		it('returns null for empty payload', async () => {
			const result = await adapter.parseWebhook({});
			expect(result).toBeNull();
		});

		it('returns null for unsupported type', async () => {
			const result = await adapter.parseWebhook({
				action: 'create',
				type: 'CycleIssue',
				data: { teamId: 'team-abc-123' },
			});
			expect(result).toBeNull();
		});

		it('returns null when no project matches teamId', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({ projects: [], fullProjects: [] });
			const result = await adapter.parseWebhook(baseLinearPayload);
			expect(result).toBeNull();
		});

		it('returns null when no teamId in data', async () => {
			const result = await adapter.parseWebhook({
				action: 'create',
				type: 'Issue',
				data: { id: 'issue-abc', title: 'Test' },
			});
			expect(result).toBeNull();
		});

		it('returns parsed event for create/Issue', async () => {
			const result = await adapter.parseWebhook(baseLinearPayload);
			expect(result).not.toBeNull();
			expect(result?.eventType).toBe('create/Issue');
			expect(result?.workItemId).toBe('issue-abc');
			expect(result?.isCommentEvent).toBe(false);
			expect(result?.projectIdentifier).toBe('team-abc-123');
		});

		it('returns parsed event for Comment (isCommentEvent=true)', async () => {
			const commentPayload = {
				action: 'create',
				type: 'Comment',
				organizationId: 'org-123',
				webhookTimestamp: Date.now(),
				data: {
					id: 'comment-xyz',
					body: 'Great fix!',
					issueId: 'issue-abc',
					teamId: 'team-abc-123',
				},
				url: 'https://linear.app/issue',
			};
			const result = await adapter.parseWebhook(commentPayload);
			expect(result).not.toBeNull();
			expect(result?.isCommentEvent).toBe(true);
			expect(result?.eventType).toBe('create/Comment');
			// For comments, workItemId is the issueId
			expect(result?.workItemId).toBe('issue-abc');
		});

		it('returns parsed event for update/Issue', async () => {
			const result = await adapter.parseWebhook({ ...baseLinearPayload, action: 'update' });
			expect(result?.eventType).toBe('update/Issue');
		});
	});

	describe('isProcessableEvent', () => {
		it('returns true for Issue events', () => {
			expect(
				adapter.isProcessableEvent({
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Issue',
					isCommentEvent: false,
				}),
			).toBe(true);
		});

		it('returns true for Comment events', () => {
			expect(
				adapter.isProcessableEvent({
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Comment',
					isCommentEvent: true,
				}),
			).toBe(true);
		});

		it('returns false for unknown event types', () => {
			expect(
				adapter.isProcessableEvent({
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Cycle',
					isCommentEvent: false,
				}),
			).toBe(false);
		});
	});

	describe('isSelfAuthored', () => {
		it('always returns false (no bot persona in Linear)', async () => {
			const result = await adapter.isSelfAuthored(
				{ projectIdentifier: 'team-abc-123', eventType: 'create/Comment', isCommentEvent: true },
				{},
			);
			expect(result).toBe(false);
		});
	});

	describe('sendReaction', () => {
		it('does nothing (no-op)', () => {
			// Should not throw
			adapter.sendReaction(
				{ projectIdentifier: 'team-abc-123', eventType: 'create/Issue', isCommentEvent: false },
				{},
			);
		});
	});

	describe('resolveProject', () => {
		it('returns project matching Linear teamId', async () => {
			const project = await adapter.resolveProject({
				projectIdentifier: 'team-abc-123',
				eventType: 'create/Issue',
				isCommentEvent: false,
			});
			expect(project?.id).toBe('p1');
		});

		it('returns null for unknown teamId', async () => {
			const project = await adapter.resolveProject({
				projectIdentifier: 'unknown-team',
				eventType: 'create/Issue',
				isCommentEvent: false,
			});
			expect(project).toBeNull();
		});
	});

	describe('dispatchWithCredentials', () => {
		it('dispatches with Linear credentials', async () => {
			vi.mocked(mockTriggerRegistry.dispatch).mockResolvedValue({
				agentType: 'implementation',
				agentInput: {},
			} as never);

			const result = await adapter.dispatchWithCredentials(
				{
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Issue',
					isCommentEvent: false,
					// @ts-expect-error extended field
					projectId: 'p1',
				},
				baseLinearPayload,
				mockProject,
				mockTriggerRegistry,
			);
			expect(result).not.toBeNull();
			expect(mockTriggerRegistry.dispatch).toHaveBeenCalled();
		});

		it('returns null when Linear credentials are missing', async () => {
			vi.mocked(resolveLinearCredentials).mockResolvedValueOnce(null);

			const result = await adapter.dispatchWithCredentials(
				{
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Issue',
					isCommentEvent: false,
					// @ts-expect-error extended field
					projectId: 'p1',
				},
				baseLinearPayload,
				mockProject,
				mockTriggerRegistry,
			);
			expect(result).toBeNull();
		});

		it('returns null when no full project config found', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValueOnce({
				projects: [mockProject],
				fullProjects: [],
			});

			const result = await adapter.dispatchWithCredentials(
				{
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Issue',
					isCommentEvent: false,
				},
				baseLinearPayload,
				mockProject,
				mockTriggerRegistry,
			);
			expect(result).toBeNull();
		});
	});

	describe('postAck', () => {
		it('posts ack and returns AckResult', async () => {
			vi.mocked(postLinearAck).mockResolvedValue('comment-123');

			const ackResult = await adapter.postAck(
				{
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Issue',
					workItemId: 'issue-abc',
					isCommentEvent: false,
					// @ts-expect-error extended field
					projectId: 'p1',
				},
				baseLinearPayload,
				mockProject,
				'implementation',
			);
			expect(ackResult?.commentId).toBe('comment-123');
			expect(ackResult?.message).toBe('Working on it...');
		});

		it('returns undefined when no workItemId', async () => {
			const ackResult = await adapter.postAck(
				{
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Issue',
					workItemId: undefined,
					isCommentEvent: false,
					// @ts-expect-error extended field
					projectId: 'p1',
				},
				baseLinearPayload,
				mockProject,
				'implementation',
			);
			expect(ackResult).toBeUndefined();
		});

		it('returns undefined when postLinearAck returns null', async () => {
			vi.mocked(postLinearAck).mockResolvedValue(null);

			const ackResult = await adapter.postAck(
				{
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Issue',
					workItemId: 'issue-abc',
					isCommentEvent: false,
					// @ts-expect-error extended field
					projectId: 'p1',
				},
				baseLinearPayload,
				mockProject,
				'implementation',
			);
			expect(ackResult).toBeUndefined();
		});

		it('appends run link footer when runLinksEnabled and dashboardUrl available', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [mockProject],
				fullProjects: [{ id: 'p1', runLinksEnabled: true } as never],
			});
			vi.mocked(getDashboardUrl).mockReturnValue('https://dashboard.example.com');
			vi.mocked(buildWorkItemRunsLink).mockReturnValue(
				'\n[View runs](https://dashboard.example.com/runs)',
			);
			vi.mocked(postLinearAck).mockResolvedValue('comment-123');

			const ackResult = await adapter.postAck(
				{
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Issue',
					workItemId: 'issue-abc',
					isCommentEvent: false,
					// @ts-expect-error extended field
					projectId: 'p1',
				},
				baseLinearPayload,
				mockProject,
				'implementation',
			);
			expect(buildWorkItemRunsLink).toHaveBeenCalled();
			expect(ackResult?.message).toContain('[View runs]');
		});

		it('handles postLinearAck error gracefully', async () => {
			vi.mocked(postLinearAck).mockRejectedValue(new Error('API error'));

			const ackResult = await adapter.postAck(
				{
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Issue',
					workItemId: 'issue-abc',
					isCommentEvent: false,
					// @ts-expect-error extended field
					projectId: 'p1',
				},
				baseLinearPayload,
				mockProject,
				'implementation',
			);
			expect(ackResult).toBeUndefined();
		});
	});

	describe('buildJob', () => {
		it('builds a linear job with correct fields', () => {
			const result = { agentType: 'implementation', agentInput: { issueId: 'issue-abc' } };
			const job = adapter.buildJob(
				{
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Issue',
					workItemId: 'issue-abc',
					isCommentEvent: false,
					// @ts-expect-error extended field
					projectId: 'p1',
					action: 'create',
					resourceType: 'Issue',
				},
				baseLinearPayload,
				mockProject,
				result as never,
			);
			expect(job.type).toBe('linear');
			expect((job as { workItemId?: string }).workItemId).toBe('issue-abc');
			expect((job as { ackCommentId?: string }).ackCommentId).toBeUndefined();
		});

		it('includes ackCommentId when ackResult is provided', () => {
			const result = { agentType: 'implementation', agentInput: {} };
			const job = adapter.buildJob(
				{
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Issue',
					workItemId: 'issue-abc',
					isCommentEvent: false,
					// @ts-expect-error extended field
					projectId: 'p1',
					action: 'create',
					resourceType: 'Issue',
				},
				baseLinearPayload,
				mockProject,
				result as never,
				{ commentId: 'comment-789', message: 'Working...' },
			);
			expect((job as { ackCommentId?: string }).ackCommentId).toBe('comment-789');
		});
	});
});

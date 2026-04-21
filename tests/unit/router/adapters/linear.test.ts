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
	resolveLinearBotUserId: vi.fn().mockResolvedValue(null),
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
	linearClient: {
		getIssueProjectId: vi.fn().mockResolvedValue(null),
	},
	withLinearCredentials: vi.fn().mockImplementation((_creds: unknown, fn: () => unknown) => fn()),
}));

import { linearClient, withLinearCredentials } from '../../../../src/linear/client.js';
import { postLinearAck, resolveLinearBotUserId } from '../../../../src/router/acknowledgments.js';
import { LinearRouterAdapter } from '../../../../src/router/adapters/linear.js';
import type { RouterProjectConfig } from '../../../../src/router/config.js';
import { loadProjectConfig } from '../../../../src/router/config.js';
import { resolveLinearCredentials } from '../../../../src/router/platformClients/index.js';
import type { TriggerRegistry } from '../../../../src/triggers/registry.js';
import { logger } from '../../../../src/utils/logging.js';
import { buildWorkItemRunsLink, getDashboardUrl } from '../../../../src/utils/runLink.js';

const mockLoggerInfo = vi.mocked(logger.info);
const mockGetIssueProjectId = vi.mocked(linearClient.getIssueProjectId);
const mockWithLinearCredentials = vi.mocked(withLinearCredentials);

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
	vi.clearAllMocks();
	mockGetIssueProjectId.mockResolvedValue(null);
	mockWithLinearCredentials.mockImplementation(
		(_creds: unknown, fn: () => unknown) => fn() as never,
	);
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

		it('returns parsed event for Comment when teamId is nested on data.issue', async () => {
			const commentPayload = {
				action: 'create',
				type: 'Comment',
				organizationId: 'org-123',
				webhookTimestamp: Date.now(),
				data: {
					id: 'comment-xyz',
					body: '@[Cascade](user-bot-id) please update this plan',
					issueId: 'issue-abc',
					issue: {
						id: 'issue-abc',
						identifier: 'TEAM-1',
						teamId: 'team-abc-123',
					},
				},
				url: 'https://linear.app/issue',
			};

			const result = await adapter.parseWebhook(commentPayload);

			expect(result).not.toBeNull();
			expect(result?.isCommentEvent).toBe(true);
			expect(result?.eventType).toBe('create/Comment');
			expect(result?.projectIdentifier).toBe('team-abc-123');
			expect(result?.workItemId).toBe('issue-abc');
		});

		it('returns parsed event for update/Issue', async () => {
			const result = await adapter.parseWebhook({ ...baseLinearPayload, action: 'update' });
			expect(result?.eventType).toBe('update/Issue');
		});
	});

	describe('parseWebhook — project scope filter', () => {
		const scopedProject: RouterProjectConfig = {
			id: 'p1',
			repo: 'owner/repo',
			pmType: 'linear',
			linear: {
				teamId: 'team-abc-123',
				projectId: 'P1',
			},
		};

		beforeEach(() => {
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [scopedProject],
				fullProjects: [{ id: 'p1' } as never],
			});
			mockLoggerInfo.mockClear();
		});

		it('Issue event — processed when data.projectId matches configured projectId', async () => {
			const result = await adapter.parseWebhook({
				...baseLinearPayload,
				data: { ...baseLinearPayload.data, projectId: 'P1' },
			});
			expect(result).not.toBeNull();
			expect(result?.workItemId).toBe('issue-abc');
		});

		it('Issue event — dropped when data.projectId does not match configured projectId', async () => {
			const result = await adapter.parseWebhook({
				...baseLinearPayload,
				data: { ...baseLinearPayload.data, projectId: 'P2' },
			});
			expect(result).toBeNull();
			expect(mockLoggerInfo).toHaveBeenCalledWith(
				expect.stringMatching(/LinearRouterAdapter: dropping event/),
				expect.objectContaining({
					reason: 'project scope mismatch',
					configuredProjectId: 'P1',
					issueProjectId: 'P2',
					issueId: 'issue-abc',
					teamId: 'team-abc-123',
					projectId: 'p1',
					eventType: 'create/Issue',
				}),
			);
		});

		it('Issue event — dropped when issue has no project and config has projectId', async () => {
			const result = await adapter.parseWebhook(baseLinearPayload);
			expect(result).toBeNull();
			expect(mockLoggerInfo).toHaveBeenCalledWith(
				expect.stringMatching(/LinearRouterAdapter: dropping event/),
				expect.objectContaining({
					reason: 'issue has no project',
					configuredProjectId: 'P1',
					issueProjectId: undefined,
				}),
			);
		});

		it('Issue event — processed regardless of projectId when config.projectId is unset', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [mockProject],
				fullProjects: [{ id: 'p1' } as never],
			});
			const resultWithProject = await adapter.parseWebhook({
				...baseLinearPayload,
				data: { ...baseLinearPayload.data, projectId: 'P-whatever' },
			});
			expect(resultWithProject).not.toBeNull();
			const resultWithoutProject = await adapter.parseWebhook(baseLinearPayload);
			expect(resultWithoutProject).not.toBeNull();
			expect(mockLoggerInfo).not.toHaveBeenCalled();
		});

		it('Comment event — processed when data.issue.projectId matches configured projectId', async () => {
			const payload = {
				action: 'create',
				type: 'Comment',
				organizationId: 'org-123',
				webhookTimestamp: Date.now(),
				data: {
					id: 'comment-xyz',
					body: 'ok',
					issueId: 'issue-abc',
					issue: { id: 'issue-abc', teamId: 'team-abc-123', projectId: 'P1' },
				},
				url: 'https://linear.app/issue',
			};
			const result = await adapter.parseWebhook(payload);
			expect(result).not.toBeNull();
			expect(result?.isCommentEvent).toBe(true);
		});

		it('Comment event — fetches issue project when Linear payload omits data.issue.projectId', async () => {
			mockGetIssueProjectId.mockResolvedValueOnce('P1');
			const payload = {
				action: 'create',
				type: 'Comment',
				organizationId: 'org-123',
				webhookTimestamp: Date.now(),
				data: {
					id: 'comment-xyz',
					body: '@cascade please update this',
					issueId: 'issue-abc',
					issue: {
						id: 'issue-abc',
						identifier: 'TEAM-1',
						teamId: 'team-abc-123',
					},
				},
				url: 'https://linear.app/issue',
			};

			const result = await adapter.parseWebhook(payload);

			expect(result).not.toBeNull();
			expect(result?.isCommentEvent).toBe(true);
			expect(mockGetIssueProjectId).toHaveBeenCalledWith('issue-abc');
			expect(mockWithLinearCredentials).toHaveBeenCalledWith(
				{ apiKey: 'lin_api_test' },
				expect.any(Function),
			);
		});

		it('Comment event — dropped when data.issue.projectId differs from configured projectId', async () => {
			const payload = {
				action: 'create',
				type: 'Comment',
				organizationId: 'org-123',
				webhookTimestamp: Date.now(),
				data: {
					id: 'comment-xyz',
					body: 'ok',
					issueId: 'issue-abc',
					teamId: 'team-abc-123',
					issue: { id: 'issue-abc', teamId: 'team-abc-123', projectId: 'P2' },
				},
				url: 'https://linear.app/issue',
			};
			const result = await adapter.parseWebhook(payload);
			expect(result).toBeNull();
			expect(mockLoggerInfo).toHaveBeenCalledWith(
				expect.stringMatching(/LinearRouterAdapter: dropping event/),
				expect.objectContaining({
					reason: 'project scope mismatch',
					configuredProjectId: 'P1',
					issueProjectId: 'P2',
					eventType: 'create/Comment',
				}),
			);
		});

		it('IssueLabel event — inspects data.projectId and drops on mismatch', async () => {
			const payload = {
				action: 'create',
				type: 'IssueLabel',
				organizationId: 'org-123',
				webhookTimestamp: Date.now(),
				data: {
					id: 'label-link-1',
					teamId: 'team-abc-123',
					projectId: 'P2',
					issueId: 'issue-abc',
				},
				url: 'https://linear.app/issue',
			};
			const result = await adapter.parseWebhook(payload);
			expect(result).toBeNull();
			expect(mockLoggerInfo).toHaveBeenCalledWith(
				expect.stringMatching(/LinearRouterAdapter: dropping event/),
				expect.objectContaining({
					reason: 'project scope mismatch',
					eventType: 'create/IssueLabel',
				}),
			);
		});

		it('cross-team intersection — Issue in matching project but wrong team is dropped by existing teamId lookup', async () => {
			const result = await adapter.parseWebhook({
				...baseLinearPayload,
				data: { ...baseLinearPayload.data, teamId: 'team-different', projectId: 'P1' },
			});
			expect(result).toBeNull();
			// Dropped by the existing "no project found for teamId" branch, not the new filter.
			// No project-scope-specific log entry should fire:
			expect(mockLoggerInfo).not.toHaveBeenCalledWith(
				expect.stringMatching(/LinearRouterAdapter: dropping event/),
				expect.any(Object),
			);
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
		it('returns false for non-comment events', async () => {
			const result = await adapter.isSelfAuthored(
				{ projectIdentifier: 'team-abc-123', eventType: 'create/Issue', isCommentEvent: false },
				{ data: { id: 'issue-abc', teamId: 'team-abc-123' } },
			);
			expect(result).toBe(false);
		});

		it('returns false when comment has no userId', async () => {
			const result = await adapter.isSelfAuthored(
				{ projectIdentifier: 'team-abc-123', eventType: 'create/Comment', isCommentEvent: true },
				{ data: { id: 'comment-xyz', body: 'Hello' } },
			);
			expect(result).toBe(false);
		});

		it('returns false when bot userId cannot be resolved', async () => {
			vi.mocked(resolveLinearBotUserId).mockResolvedValueOnce(null);
			const result = await adapter.isSelfAuthored(
				{
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Comment',
					isCommentEvent: true,
					// @ts-expect-error extended field
					projectId: 'p1',
				},
				{ data: { id: 'comment-xyz', body: 'Hello', userId: 'user-bot-id' } },
			);
			expect(result).toBe(false);
		});

		it('returns true when comment userId matches bot userId', async () => {
			vi.mocked(resolveLinearBotUserId).mockResolvedValueOnce('user-bot-id');
			const result = await adapter.isSelfAuthored(
				{
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Comment',
					isCommentEvent: true,
					// @ts-expect-error extended field
					projectId: 'p1',
				},
				{ data: { id: 'comment-xyz', body: 'Hello', userId: 'user-bot-id' } },
			);
			expect(result).toBe(true);
		});

		it('returns false when comment userId does not match bot userId', async () => {
			vi.mocked(resolveLinearBotUserId).mockResolvedValueOnce('user-bot-id');
			const result = await adapter.isSelfAuthored(
				{
					projectIdentifier: 'team-abc-123',
					eventType: 'create/Comment',
					isCommentEvent: true,
					// @ts-expect-error extended field
					projectId: 'p1',
				},
				{ data: { id: 'comment-xyz', body: 'Hello', userId: 'user-other-id' } },
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

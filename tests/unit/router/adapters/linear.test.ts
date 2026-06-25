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
// Spec 017 / plan 2: PM router adapters wrap dispatch in `withPMScopeForDispatch`
// (PM-provider AsyncLocalStorage scope). Mock the helper as passthrough so the
// existing tests don't pull the real PM manifest registry into the assertion.
vi.mock('../../../../src/router/adapters/_shared.js', () => ({
	withPMScopeForDispatch: vi.fn().mockImplementation((_p: unknown, fn: () => unknown) => fn()),
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
			// 2026-05-11: log shape changed when project selection moved before
			// scope filtering. `reason` is now "no candidate matches issue project"
			// (the issue HAS a project, we just didn't find a candidate that
			// subscribes to it). The log also lists all candidates so operators
			// can see why none matched.
			expect(mockLoggerInfo).toHaveBeenCalledWith(
				expect.stringMatching(/LinearRouterAdapter: dropping event/),
				expect.objectContaining({
					reason: 'no candidate matches issue project',
					issueProjectId: 'P2',
					issueId: 'issue-abc',
					teamId: 'team-abc-123',
					candidates: [{ id: 'p1', projectId: 'P1' }],
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
					issueProjectId: undefined,
					candidates: [{ id: 'p1', projectId: 'P1' }],
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
					reason: 'no candidate matches issue project',
					issueProjectId: 'P2',
					candidates: [{ id: 'p1', projectId: 'P1' }],
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
					reason: 'no candidate matches issue project',
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

	// 2026-05-11: multi-cascade-project-per-Linear-team support. Closes the
	// MNG-638 regression where cascade was migrated from Trello → Linear and
	// both `cascade` and `ucho` ended up scoped to the same Linear team. The
	// `.find()` returned only the first match (ucho), then the follow-up
	// scope filter dropped the event because the issue's Linear Project
	// (`83a0f22b-...`) didn't match ucho's scope (`7108c72e-...`). Now the
	// adapter picks the candidate based on teamId AND issue's Linear Project,
	// not just team.
	describe('parseWebhook — multi-cascade-project-per-team', () => {
		const cascadeProject: RouterProjectConfig = {
			id: 'cascade',
			repo: 'mongrel/cascade',
			pmType: 'linear',
			linear: { teamId: 'team-abc-123', projectId: 'P-cascade' },
		};
		const uchoProject: RouterProjectConfig = {
			id: 'ucho',
			repo: 'mongrel/ucho',
			pmType: 'linear',
			linear: { teamId: 'team-abc-123', projectId: 'P-ucho' },
		};

		beforeEach(() => {
			mockLoggerInfo.mockClear();
		});

		it('routes to the cascade project whose Linear scope matches the issue project (was the .find()-first-match bug)', async () => {
			// Two cascade projects on the same Linear team; ucho appears first
			// in the projects array. Pre-fix the .find() would have returned
			// ucho regardless of the issue's project, and the follow-up scope
			// filter would have dropped the event. The new code looks at all
			// candidates and matches on issue's projectId.
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [uchoProject, cascadeProject],
				fullProjects: [{ id: 'ucho' } as never, { id: 'cascade' } as never],
			});

			const result = await adapter.parseWebhook({
				...baseLinearPayload,
				data: { ...baseLinearPayload.data, projectId: 'P-cascade' },
			});

			expect(result).not.toBeNull();
			expect(result?.projectId).toBe('cascade');
			expect(mockLoggerInfo).not.toHaveBeenCalled();
		});

		it('routes to ucho when the issue belongs to ucho (mirror of the cascade case)', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [uchoProject, cascadeProject],
				fullProjects: [{ id: 'ucho' } as never, { id: 'cascade' } as never],
			});

			const result = await adapter.parseWebhook({
				...baseLinearPayload,
				data: { ...baseLinearPayload.data, projectId: 'P-ucho' },
			});

			expect(result).not.toBeNull();
			expect(result?.projectId).toBe('ucho');
		});

		it('drops the event when no candidate subscribes to the issue project; log includes all candidates', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [uchoProject, cascadeProject],
				fullProjects: [{ id: 'ucho' } as never, { id: 'cascade' } as never],
			});

			const result = await adapter.parseWebhook({
				...baseLinearPayload,
				data: { ...baseLinearPayload.data, projectId: 'P-orphan' },
			});

			expect(result).toBeNull();
			expect(mockLoggerInfo).toHaveBeenCalledWith(
				expect.stringMatching(/LinearRouterAdapter: dropping event/),
				expect.objectContaining({
					reason: 'no candidate matches issue project',
					issueProjectId: 'P-orphan',
					candidates: [
						{ id: 'ucho', projectId: 'P-ucho' },
						{ id: 'cascade', projectId: 'P-cascade' },
					],
				}),
			);
		});

		it('drops the event when issue has no project and all candidates are scoped', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [uchoProject, cascadeProject],
				fullProjects: [{ id: 'ucho' } as never, { id: 'cascade' } as never],
			});

			const result = await adapter.parseWebhook(baseLinearPayload);

			expect(result).toBeNull();
			expect(mockLoggerInfo).toHaveBeenCalledWith(
				expect.stringMatching(/LinearRouterAdapter: dropping event/),
				expect.objectContaining({
					reason: 'issue has no project',
					issueProjectId: undefined,
				}),
			);
		});

		it('falls back to an unscoped catch-all candidate when no scoped candidate matches', async () => {
			const catchAll: RouterProjectConfig = {
				id: 'catch-all',
				repo: 'mongrel/catchall',
				pmType: 'linear',
				linear: { teamId: 'team-abc-123' },
			};
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [cascadeProject, catchAll],
				fullProjects: [{ id: 'cascade' } as never, { id: 'catch-all' } as never],
			});

			const result = await adapter.parseWebhook({
				...baseLinearPayload,
				data: { ...baseLinearPayload.data, projectId: 'P-unmatched' },
			});

			expect(result).not.toBeNull();
			expect(result?.projectId).toBe('catch-all');
		});

		it('prefers the scoped match over an unscoped catch-all when both are configured', async () => {
			const catchAll: RouterProjectConfig = {
				id: 'catch-all',
				repo: 'mongrel/catchall',
				pmType: 'linear',
				linear: { teamId: 'team-abc-123' },
			};
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [catchAll, cascadeProject],
				fullProjects: [{ id: 'catch-all' } as never, { id: 'cascade' } as never],
			});

			const result = await adapter.parseWebhook({
				...baseLinearPayload,
				data: { ...baseLinearPayload.data, projectId: 'P-cascade' },
			});

			expect(result).not.toBeNull();
			// Scoped match wins even though catch-all comes first in array order.
			expect(result?.projectId).toBe('cascade');
		});

		it('Comment event fetches issue project via API and routes to the right scoped candidate', async () => {
			mockGetIssueProjectId.mockResolvedValueOnce('P-cascade');
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [uchoProject, cascadeProject],
				fullProjects: [{ id: 'ucho' } as never, { id: 'cascade' } as never],
			});

			const payload = {
				action: 'create',
				type: 'Comment',
				organizationId: 'org-123',
				webhookTimestamp: Date.now(),
				data: {
					id: 'comment-xyz',
					body: '@cascade please update',
					issueId: 'issue-abc',
					issue: { id: 'issue-abc', identifier: 'TEAM-1', teamId: 'team-abc-123' },
				},
				url: 'https://linear.app/issue',
			};

			const result = await adapter.parseWebhook(payload);

			expect(result).not.toBeNull();
			expect(result?.projectId).toBe('cascade');
			// The API call uses the FIRST candidate's id — Linear creds are
			// per-team so any candidate's creds work for the issue lookup.
			expect(mockGetIssueProjectId).toHaveBeenCalledWith('issue-abc');
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
		// Existing tests — bare ParsedWebhookEvent (no Linear extension)
		// exercise the teamId-fallback branch. Single-cascade-project-per-team
		// setups continue working unchanged.
		it('returns project matching Linear teamId (legacy bare-event path)', async () => {
			const project = await adapter.resolveProject({
				projectIdentifier: 'team-abc-123',
				eventType: 'create/Issue',
				isCommentEvent: false,
			});
			expect(project?.id).toBe('p1');
		});

		it('returns null for unknown teamId (legacy bare-event path)', async () => {
			const project = await adapter.resolveProject({
				projectIdentifier: 'unknown-team',
				eventType: 'create/Issue',
				isCommentEvent: false,
			});
			expect(project).toBeNull();
		});

		// 2026-05-11: multi-cascade-project-per-Linear-team support. Closes
		// the MNG-638 regression that surfaced after `cascade` was migrated
		// from Trello → Linear, putting both `cascade` and `ucho` cascade
		// projects on the same Linear team. PR #1332 fixed parseWebhook but
		// missed THIS call site — `resolveProject` was re-looking up by
		// teamId and returning the first array match, discarding the cascade
		// project that parseWebhook had correctly selected.
		describe('multi-cascade-project-per-team — uses event.projectId from LinearParsedEvent', () => {
			const cascadeProject: RouterProjectConfig = {
				id: 'cascade',
				repo: 'mongrel/cascade',
				pmType: 'linear',
				linear: { teamId: 'team-abc-123', projectId: 'P-cascade' },
			};
			const uchoProject: RouterProjectConfig = {
				id: 'ucho',
				repo: 'mongrel/ucho',
				pmType: 'linear',
				linear: { teamId: 'team-abc-123', projectId: 'P-ucho' },
			};

			beforeEach(() => {
				vi.mocked(loadProjectConfig).mockResolvedValue({
					projects: [cascadeProject, uchoProject],
					fullProjects: [{ id: 'cascade' } as never, { id: 'ucho' } as never],
				});
			});

			it('returns ucho when event.projectId is "ucho", regardless of array order', async () => {
				const project = await adapter.resolveProject({
					projectIdentifier: 'team-abc-123',
					eventType: 'update/Issue',
					isCommentEvent: false,
					// @ts-expect-error LinearParsedEvent extension field
					projectId: 'ucho',
					action: 'update',
					resourceType: 'Issue',
				});
				// Pre-fix this returned `cascade` (first match by teamId).
				expect(project?.id).toBe('ucho');
			});

			it('returns cascade when event.projectId is "cascade"', async () => {
				const project = await adapter.resolveProject({
					projectIdentifier: 'team-abc-123',
					eventType: 'update/Issue',
					isCommentEvent: false,
					// @ts-expect-error LinearParsedEvent extension field
					projectId: 'cascade',
					action: 'update',
					resourceType: 'Issue',
				});
				expect(project?.id).toBe('cascade');
			});

			it('returns null when event.projectId points at no configured cascade project (fail-closed)', async () => {
				const project = await adapter.resolveProject({
					projectIdentifier: 'team-abc-123',
					eventType: 'update/Issue',
					isCommentEvent: false,
					// @ts-expect-error LinearParsedEvent extension field
					projectId: 'never-configured-project',
					action: 'update',
					resourceType: 'Issue',
				});
				expect(project).toBeNull();
			});

			it('falls back to teamId lookup when event lacks the projectId extension (legacy compat)', async () => {
				// Bare event — no `projectId` field. The fallback `.find()` by
				// teamId returns the first match (cascade) — same as the legacy
				// behavior. Real production calls go through parseWebhook which
				// always populates `projectId`; this only matters for unit tests
				// or external callers that construct events directly.
				const project = await adapter.resolveProject({
					projectIdentifier: 'team-abc-123',
					eventType: 'update/Issue',
					isCommentEvent: false,
				});
				expect(project?.id).toBe('cascade');
			});
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

		// MNG-1684: the PM ack is communication-only and is gated on the agent's
		// resolved update channel.
		it('skips the PM ack when the update channel disables PM posting', async () => {
			vi.mocked(loadProjectConfig).mockResolvedValue({
				projects: [mockProject],
				fullProjects: [{ id: 'p1', agentUpdateChannels: { implementation: 'scm-only' } } as never],
			});

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
			expect(postLinearAck).not.toHaveBeenCalled();
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

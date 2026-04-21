import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger, mockTriggerCheckModule } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));
vi.mock('../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

// Mock resolveLinearBotIdentity to avoid real API calls
const mockResolveLinearBotIdentity = vi.fn();
vi.mock('../../../src/router/bot-identity-resolvers.js', () => ({
	resolveLinearBotIdentity: (...args: unknown[]) => mockResolveLinearBotIdentity(...args),
}));

import { LinearCommentMentionTrigger } from '../../../src/triggers/linear/comment-mention.js';
import { checkTriggerEnabled } from '../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../src/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOT_USER_ID = 'bot-user-uuid-001';
const BOT_IDENTITY = {
	id: BOT_USER_ID,
	name: 'cascade',
	email: 'cascade@example.test',
	displayName: 'cascade',
};
const OTHER_USER_ID = 'user-other-uuid-456';
const ISSUE_IDENTIFIER = 'TEAM-99';
const ISSUE_ID = 'issue-uuid-99';

const mockProject = {
	id: 'proj-linear',
	orgId: 'org-1',
	name: 'Linear Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	pm: { type: 'linear' as const },
} as TriggerContext['project'];

function buildCtx(
	overrides: {
		source?: TriggerContext['source'];
		action?: string;
		type?: string;
		commentBody?: string;
		commentAuthorId?: string;
		issueIdentifier?: string;
		issueId?: string;
		issueUrl?: string;
		noIssue?: boolean;
	} = {},
): TriggerContext {
	const issue = overrides.noIssue
		? undefined
		: {
				id: overrides.issueId ?? ISSUE_ID,
				identifier: overrides.issueIdentifier ?? ISSUE_IDENTIFIER,
				title: 'Test issue',
				teamId: 'team-abc',
				url: overrides.issueUrl ?? 'https://linear.app/org/issue/TEAM-99',
				stateId: 'state-todo',
			};

	return {
		project: mockProject,
		source: overrides.source ?? 'linear',
		payload: {
			action: overrides.action ?? 'create',
			type: overrides.type ?? 'Comment',
			organizationId: 'org-123',
			webhookTimestamp: Date.now(),
			data: {
				id: 'comment-uuid',
				// Include botUserId in the body to simulate an @mention
				body: overrides.commentBody ?? `@[Bot User](${BOT_USER_ID}) please help with this issue`,
				issueId: ISSUE_ID,
				userId: overrides.commentAuthorId ?? OTHER_USER_ID,
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z',
				issue,
			},
			url: 'https://linear.app',
		},
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LinearCommentMentionTrigger', () => {
	let trigger: LinearCommentMentionTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(checkTriggerEnabled).mockResolvedValue(true);
		mockResolveLinearBotIdentity.mockResolvedValue(BOT_IDENTITY);
		trigger = new LinearCommentMentionTrigger();
	});

	// =========================================================================
	// matches
	// =========================================================================
	describe('matches', () => {
		it('matches create/Comment events from linear source', () => {
			expect(trigger.matches(buildCtx())).toBe(true);
		});

		it('does not match non-linear source', () => {
			expect(trigger.matches(buildCtx({ source: 'jira' }))).toBe(false);
		});

		it('does not match non-create actions', () => {
			expect(trigger.matches(buildCtx({ action: 'update' }))).toBe(false);
		});

		it('does not match non-Comment types', () => {
			expect(trigger.matches(buildCtx({ type: 'Issue' }))).toBe(false);
		});

		it('does not match IssueLabel type', () => {
			expect(trigger.matches(buildCtx({ type: 'IssueLabel' }))).toBe(false);
		});
	});

	// =========================================================================
	// handle
	// =========================================================================
	describe('handle', () => {
		it('returns respond-to-planning-comment result when @mention found', async () => {
			const result = await trigger.handle(buildCtx());

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('respond-to-planning-comment');
			expect(result?.workItemId).toBe(ISSUE_IDENTIFIER);
			expect(result?.workItemUrl).toBe('https://linear.app/org/issue/TEAM-99');
			expect(result?.agentInput.workItemId).toBe(ISSUE_IDENTIFIER);
			expect(result?.agentInput.triggerEvent).toBe('pm:comment-mention');
		});

		it('includes triggerCommentText in agentInput', async () => {
			const body = `@[Bot](${BOT_USER_ID}) please implement feature X`;
			const result = await trigger.handle(buildCtx({ commentBody: body }));

			expect(result?.agentInput.triggerCommentText).toBe(body);
		});

		it('returns respond-to-planning-comment result when Linear sends a plain @handle mention', async () => {
			const body = '@cascade please apply the correction before splitting';

			const result = await trigger.handle(buildCtx({ commentBody: body }));

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('respond-to-planning-comment');
			expect(result?.agentInput.triggerCommentText).toBe(body);
		});

		it('matches plain @handle mentions using the bot email local-part', async () => {
			mockResolveLinearBotIdentity.mockResolvedValueOnce({
				id: BOT_USER_ID,
				name: 'Cascade Bot',
				email: 'cascade@example.test',
				displayName: 'Cascade Bot',
			});

			const result = await trigger.handle(buildCtx({ commentBody: '@cascade please respond' }));

			expect(result).not.toBeNull();
		});

		it('includes commentAuthorId in agentInput', async () => {
			const result = await trigger.handle(buildCtx({ commentAuthorId: OTHER_USER_ID }));

			expect(result?.agentInput.triggerCommentAuthor).toBe(OTHER_USER_ID);
		});

		it('returns null when trigger is disabled', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValue(false);

			const result = await trigger.handle(buildCtx());

			expect(result).toBeNull();
			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'proj-linear',
				'respond-to-planning-comment',
				'pm:comment-mention',
				'linear-comment-mention',
			);
		});

		it('returns null when issueIdentifier is missing', async () => {
			const result = await trigger.handle(buildCtx({ noIssue: true }));
			expect(result).toBeNull();
		});

		it('returns null when commentBody is missing', async () => {
			const ctx = buildCtx({ commentBody: '' });
			const data = ctx.payload as Record<string, unknown>;
			(data.data as Record<string, unknown>).body = '';
			const result = await trigger.handle(ctx);
			expect(result).toBeNull();
		});

		it('returns null when bot userId cannot be resolved', async () => {
			mockResolveLinearBotIdentity.mockResolvedValue(null);

			const result = await trigger.handle(buildCtx());

			expect(result).toBeNull();
		});

		it('returns null when comment is self-authored by the bot', async () => {
			// Comment author is the bot itself
			const result = await trigger.handle(buildCtx({ commentAuthorId: BOT_USER_ID }));
			expect(result).toBeNull();
		});

		it('returns null when comment body does not @mention the bot', async () => {
			// No bot userId in the body
			const result = await trigger.handle(
				buildCtx({ commentBody: 'Just a regular comment, no mention' }),
			);
			expect(result).toBeNull();
		});

		it('includes linearIssueId in agentInput', async () => {
			const result = await trigger.handle(buildCtx({ issueId: 'issue-uuid-99' }));

			expect(result?.agentInput.linearIssueId).toBe('issue-uuid-99');
		});

		it('uses issue.id as fallback when identifier is missing', async () => {
			const ctx = buildCtx();
			const data = ctx.payload as Record<string, unknown>;
			(data.data as Record<string, unknown>).issue = {
				id: 'fallback-issue-id',
				// no identifier
				url: 'https://linear.app/org/issue/fallback',
			};
			const result = await trigger.handle(ctx);
			expect(result?.workItemId).toBe('fallback-issue-id');
		});

		it('resolves botUserId using the project ID', async () => {
			await trigger.handle(buildCtx());

			expect(mockResolveLinearBotIdentity).toHaveBeenCalledWith('proj-linear');
		});

		it('workItemTitle is undefined (not available in comment webhook)', async () => {
			const result = await trigger.handle(buildCtx());
			expect(result?.workItemTitle).toBeUndefined();
		});

		it('uses issueId from data.issueId when issue is present in data', async () => {
			const ctx = buildCtx({ issueId: 'issue-uuid-99' });
			const result = await trigger.handle(ctx);
			expect(result?.agentInput.linearIssueId).toBe('issue-uuid-99');
		});
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before any imports
const { mockJiraClientGetMyself, mockCheckTriggerEnabled, mockLogger } = vi.hoisted(() => ({
	mockJiraClientGetMyself: vi.fn(),
	mockCheckTriggerEnabled: vi.fn().mockResolvedValue(true),
	mockLogger: {
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../src/jira/client.js', () => ({
	jiraClient: {
		getMyself: mockJiraClientGetMyself,
	},
}));

vi.mock('../../../src/triggers/shared/trigger-check.js', () => ({
	checkTriggerEnabled: mockCheckTriggerEnabled,
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import { JiraCommentMentionTrigger } from '../../../src/triggers/jira/comment-mention.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

const BOT_ACCOUNT_ID = 'bot-account-001';
const BOT_DISPLAY_NAME = 'CascadeBot';
const OTHER_ACCOUNT_ID = 'user-account-456';
const ISSUE_KEY = 'PROJ-123';

function makeProject() {
	return {
		id: 'project-1',
		name: 'Test Project',
		repo: 'owner/repo',
		baseBranch: 'main',
		jira: { projectKey: 'PROJ' },
	} as TriggerContext['project'];
}

function makeCtx(
	overrides: {
		source?: TriggerContext['source'];
		webhookEvent?: string;
		issueKey?: string;
		commentBody?: unknown;
		commentAuthorAccountId?: string;
		commentAuthorDisplayName?: string;
	} = {},
): TriggerContext {
	const payload = {
		webhookEvent: overrides.webhookEvent ?? 'comment_created',
		issue: { key: overrides.issueKey ?? ISSUE_KEY },
		comment: {
			body: overrides.commentBody ?? `[~accountid:${BOT_ACCOUNT_ID}] please help`,
			author: {
				accountId: overrides.commentAuthorAccountId ?? OTHER_ACCOUNT_ID,
				displayName: overrides.commentAuthorDisplayName ?? 'Alice',
			},
		},
	};

	return {
		project: makeProject(),
		source: overrides.source ?? 'jira',
		payload,
	};
}

function makeAdfBody(mentionAccountId: string) {
	return {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [
					{
						type: 'mention',
						attrs: { id: mentionAccountId, text: '@CascadeBot' },
					},
					{ type: 'text', text: ' please review this' },
				],
			},
		],
	};
}

describe('JiraCommentMentionTrigger', () => {
	let trigger: JiraCommentMentionTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(mockCheckTriggerEnabled).mockResolvedValue(true);
		mockJiraClientGetMyself.mockResolvedValue({
			accountId: BOT_ACCOUNT_ID,
			displayName: BOT_DISPLAY_NAME,
		});
		trigger = new JiraCommentMentionTrigger();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('matches', () => {
		it('matches comment_created events from jira source', () => {
			expect(trigger.matches(makeCtx())).toBe(true);
		});

		it('matches comment_updated events from jira source', () => {
			expect(trigger.matches(makeCtx({ webhookEvent: 'comment_updated' }))).toBe(true);
		});

		it('does not match non-jira source', () => {
			expect(trigger.matches(makeCtx({ source: 'trello' }))).toBe(false);
		});

		it('does not match non-comment events', () => {
			expect(trigger.matches(makeCtx({ webhookEvent: 'jira:issue_updated' }))).toBe(false);
		});

		it('does not match issue_commented events (wrong format)', () => {
			expect(trigger.matches(makeCtx({ webhookEvent: 'jira:issue_commented' }))).toBe(false);
		});
	});

	describe('handle', () => {
		it('returns null when trigger is disabled', async () => {
			vi.mocked(mockCheckTriggerEnabled).mockResolvedValueOnce(false);

			const result = await trigger.handle(makeCtx());

			expect(result).toBeNull();
			expect(mockCheckTriggerEnabled).toHaveBeenCalledWith(
				'project-1',
				'respond-to-planning-comment',
				'pm:comment-mention',
				'jira-comment-mention',
			);
		});

		it('returns null when issueKey is missing', async () => {
			const ctx = makeCtx({ issueKey: '' });
			(ctx.payload as Record<string, unknown>).issue = undefined;

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when commentBody is missing', async () => {
			const ctx = makeCtx();
			(ctx.payload as Record<string, unknown>).comment = {
				author: { accountId: OTHER_ACCOUNT_ID },
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns result with agentInput when @mention found (wiki markup)', async () => {
			const result = await trigger.handle(makeCtx());

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('respond-to-planning-comment');
			expect(result?.workItemId).toBe(ISSUE_KEY);
			expect(result?.agentInput.cardId).toBe(ISSUE_KEY);
			expect(result?.agentInput.triggerCommentAuthor).toBe('Alice');
			expect(result?.agentInput.triggerEvent).toBe('pm:comment-mention');
		});

		it('returns result when @mention found in ADF body', async () => {
			const adfBody = makeAdfBody(BOT_ACCOUNT_ID);
			const result = await trigger.handle(makeCtx({ commentBody: adfBody }));

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('respond-to-planning-comment');
		});

		it('returns null when no @mention of bot in wiki markup', async () => {
			const result = await trigger.handle(
				makeCtx({ commentBody: 'Just a regular comment without mention' }),
			);

			expect(result).toBeNull();
		});

		it('returns null when ADF body mentions a different account', async () => {
			const adfBody = makeAdfBody('some-other-account');
			const result = await trigger.handle(makeCtx({ commentBody: adfBody }));

			expect(result).toBeNull();
		});

		it('returns null when comment is self-authored (prevents infinite loop)', async () => {
			const result = await trigger.handle(makeCtx({ commentAuthorAccountId: BOT_ACCOUNT_ID }));

			expect(result).toBeNull();
		});

		it('includes triggerCommentText in agentInput (wiki markup)', async () => {
			const result = await trigger.handle(
				makeCtx({ commentBody: `[~accountid:${BOT_ACCOUNT_ID}] please do this thing` }),
			);

			expect(result?.agentInput.triggerCommentText).toContain('please do this thing');
		});

		it('includes comment author display name in agentInput', async () => {
			const result = await trigger.handle(makeCtx({ commentAuthorDisplayName: 'Bob Smith' }));

			expect(result?.agentInput.triggerCommentAuthor).toBe('Bob Smith');
		});

		it('uses "unknown" as author when displayName is missing', async () => {
			const ctx = makeCtx();
			const payload = ctx.payload as Record<string, unknown>;
			(payload.comment as Record<string, unknown>).author = { accountId: OTHER_ACCOUNT_ID };

			const result = await trigger.handle(ctx);

			expect(result?.agentInput.triggerCommentAuthor).toBe('unknown');
		});

		it('handles multiple calls correctly (caches user info)', async () => {
			// First call
			const result1 = await trigger.handle(makeCtx());
			// Second call
			const result2 = await trigger.handle(makeCtx());

			expect(result1).not.toBeNull();
			expect(result2).not.toBeNull();
			// getMyself should be called at most once per trigger instance
			expect(mockJiraClientGetMyself.mock.calls.length).toBeLessThanOrEqual(2);
		});
	});
});

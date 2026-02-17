import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TriggerContext } from '../../../src/types/index.js';

const { mockGetMyself } = vi.hoisted(() => ({
	mockGetMyself: vi.fn(),
}));

vi.mock('../../../src/jira/client.js', () => ({
	jiraClient: {
		getMyself: mockGetMyself,
	},
}));

// Import after vi.mock is hoisted
import { JiraCommentMentionTrigger } from '../../../src/triggers/jira/comment-mention.js';

const BOT_ACCOUNT_ID = 'bot-account-123';
const BOT_DISPLAY_NAME = 'CASCADE Bot';
const OTHER_ACCOUNT_ID = 'user-account-456';

const mockProject = {
	id: 'test-project',
	name: 'Test Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
} as TriggerContext['project'];

/** Build a realistic JIRA ADF comment body with an @mention */
function buildAdfBodyWithMention(mentionAccountId: string, text = 'please look at this'): unknown {
	return {
		version: 1,
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [
					{
						type: 'mention',
						attrs: {
							id: mentionAccountId,
							text: '@cascade-bot',
							accessLevel: '',
						},
					},
					{
						type: 'text',
						text: ` ${text}`,
					},
				],
			},
		],
	};
}

/** Build an ADF body with no mentions */
function buildAdfBodyPlainText(text = 'just a regular comment'): unknown {
	return {
		version: 1,
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [
					{
						type: 'text',
						text,
					},
				],
			},
		],
	};
}

function buildCtx(
	overrides: {
		webhookEvent?: string;
		issueKey?: string;
		commentBody?: unknown;
		commentAuthorAccountId?: string;
		commentAuthorName?: string;
		source?: TriggerContext['source'];
	} = {},
): TriggerContext {
	return {
		project: mockProject,
		source: overrides.source ?? 'jira',
		payload: {
			webhookEvent: overrides.webhookEvent ?? 'comment_created',
			issue: overrides.issueKey !== undefined ? { key: overrides.issueKey } : { key: 'DAM-13' },
			comment: {
				body: overrides.commentBody ?? buildAdfBodyWithMention(BOT_ACCOUNT_ID),
				author: {
					displayName: overrides.commentAuthorName ?? 'Human User',
					accountId: overrides.commentAuthorAccountId ?? OTHER_ACCOUNT_ID,
				},
			},
		},
	};
}

describe('JiraCommentMentionTrigger', () => {
	let trigger: JiraCommentMentionTrigger;

	beforeEach(() => {
		trigger = new JiraCommentMentionTrigger();
		mockGetMyself.mockResolvedValue({
			accountId: BOT_ACCOUNT_ID,
			displayName: BOT_DISPLAY_NAME,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('matches', () => {
		it('matches comment_created from jira source', () => {
			expect(trigger.matches(buildCtx({ webhookEvent: 'comment_created' }))).toBe(true);
		});

		it('matches comment_updated from jira source', () => {
			expect(trigger.matches(buildCtx({ webhookEvent: 'comment_updated' }))).toBe(true);
		});

		it('does not match non-jira source', () => {
			expect(trigger.matches(buildCtx({ source: 'trello' }))).toBe(false);
		});

		it('does not match other webhook events', () => {
			expect(trigger.matches(buildCtx({ webhookEvent: 'issue_updated' }))).toBe(false);
		});
	});

	describe('handle', () => {
		it('triggers agent when bot is @mentioned in comment', async () => {
			const ctx = buildCtx();
			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('respond-to-planning-comment');
			expect(result?.workItemId).toBe('DAM-13');
			expect(result?.agentInput.cardId).toBe('DAM-13');
			expect(result?.agentInput.triggerCommentAuthor).toBe('Human User');
			expect(result?.agentInput.triggerCommentText).toContain('@cascade-bot');
		});

		it('returns null when @mention is for a different user', async () => {
			const ctx = buildCtx({
				commentBody: buildAdfBodyWithMention('some-other-user-789'),
			});
			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when comment is self-authored (prevents infinite loop)', async () => {
			const ctx = buildCtx({
				commentAuthorAccountId: BOT_ACCOUNT_ID,
				commentBody: buildAdfBodyWithMention(BOT_ACCOUNT_ID),
			});
			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when comment has no mentions', async () => {
			const ctx = buildCtx({
				commentBody: buildAdfBodyPlainText(),
			});
			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when comment body is missing', async () => {
			const ctx = buildCtx();
			(ctx.payload as Record<string, unknown>).comment = {
				author: { displayName: 'User', accountId: OTHER_ACCOUNT_ID },
			};
			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null when issue key is missing', async () => {
			const ctx = buildCtx();
			(ctx.payload as Record<string, unknown>).issue = undefined;
			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});
	});
});

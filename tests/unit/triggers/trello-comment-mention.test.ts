import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const { mockGetMe, mockGetCard } = vi.hoisted(() => ({
	mockGetMe: vi.fn(),
	mockGetCard: vi.fn(),
}));

vi.mock('../../../src/trello/client.js', () => ({
	trelloClient: {
		getMe: mockGetMe,
		getCard: mockGetCard,
	},
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
}));

// We need to reset the module-level cache between tests.
// The module uses a module-level variable `cachedMemberInfo`.
// We can reset it by re-importing with vi.resetModules() or by calling the exported functions.

import { TrelloCommentMentionTrigger } from '../../../src/triggers/trello/comment-mention.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

const BOT_MEMBER_ID = 'bot-member-123';
const BOT_USERNAME = 'cascadebot';
const OTHER_MEMBER_ID = 'user-member-456';
const PLANNING_LIST_ID = 'planning-list-id';

const mockProject = {
	id: 'test-project',
	name: 'Test Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	trello: {
		boardId: 'board-123',
		lists: {
			briefing: 'briefing-list-id',
			planning: PLANNING_LIST_ID,
			todo: 'todo-list-id',
		},
		labels: {},
	},
} as TriggerContext['project'];

function buildCtx(
	overrides: {
		source?: TriggerContext['source'];
		actionType?: string;
		cardId?: string;
		commentText?: string;
		idMemberCreator?: string;
		memberCreatorUsername?: string;
		noPlanningList?: boolean;
	} = {},
): TriggerContext {
	const project = overrides.noPlanningList
		? { ...mockProject, trello: { ...mockProject.trello, lists: {} } }
		: mockProject;

	return {
		project: project as TriggerContext['project'],
		source: overrides.source ?? 'trello',
		payload: {
			model: { id: 'board-123', name: 'Board' },
			action: {
				id: 'action-1',
				idMemberCreator: overrides.idMemberCreator ?? OTHER_MEMBER_ID,
				type: overrides.actionType ?? 'commentCard',
				date: '2024-01-01',
				memberCreator: {
					id: overrides.idMemberCreator ?? OTHER_MEMBER_ID,
					username: overrides.memberCreatorUsername ?? 'human-user',
				},
				data: {
					card: {
						id: overrides.cardId ?? 'card-1',
						name: 'Test Card',
						idShort: 1,
						shortLink: 'abc',
					},
					text: overrides.commentText ?? `@${BOT_USERNAME} please review`,
				},
			},
		},
	};
}

describe('TrelloCommentMentionTrigger', () => {
	let trigger: TrelloCommentMentionTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		trigger = new TrelloCommentMentionTrigger();
		// Reset the module-level member info cache by re-importing.
		// The cache is a module-level variable, so we set up getMe to always respond.
		mockGetMe.mockResolvedValue({ id: BOT_MEMBER_ID, username: BOT_USERNAME });
		mockGetCard.mockResolvedValue({
			id: 'card-1',
			idList: PLANNING_LIST_ID,
			name: 'Test Card',
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('matches', () => {
		it('matches commentCard action from trello source', () => {
			expect(trigger.matches(buildCtx())).toBe(true);
		});

		it('does not match non-trello source', () => {
			expect(trigger.matches(buildCtx({ source: 'github' }))).toBe(false);
		});

		it('does not match non-commentCard action types', () => {
			expect(trigger.matches(buildCtx({ actionType: 'updateCard' }))).toBe(false);
		});

		it('does not match createCard action', () => {
			expect(trigger.matches(buildCtx({ actionType: 'createCard' }))).toBe(false);
		});
	});

	describe('handle', () => {
		it('returns respond-to-planning-comment result when @mention is present on PLANNING card', async () => {
			const result = await trigger.handle(buildCtx());

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('respond-to-planning-comment');
			expect(result?.cardId).toBe('card-1');
			expect(result?.agentInput.cardId).toBe('card-1');
			expect(result?.agentInput.triggerCommentText).toContain(`@${BOT_USERNAME}`);
		});

		it('includes comment author in agentInput', async () => {
			const result = await trigger.handle(buildCtx({ memberCreatorUsername: 'alice-human' }));

			expect(result?.agentInput.triggerCommentAuthor).toBe('alice-human');
		});

		it('returns null when comment has no @mention', async () => {
			const result = await trigger.handle(
				buildCtx({ commentText: 'Just a regular comment without mention' }),
			);

			expect(result).toBeNull();
		});

		it('returns null when self-authored comment (prevents infinite loop)', async () => {
			const result = await trigger.handle(
				buildCtx({
					idMemberCreator: BOT_MEMBER_ID,
					commentText: `@${BOT_USERNAME} this is from the bot itself`,
				}),
			);

			expect(result).toBeNull();
		});

		it('returns null when card is not in PLANNING list', async () => {
			mockGetCard.mockResolvedValue({
				id: 'card-1',
				idList: 'some-other-list-id',
				name: 'Test Card',
			});

			const result = await trigger.handle(buildCtx());

			expect(result).toBeNull();
		});

		it('returns null when planning list is not configured in project', async () => {
			const result = await trigger.handle(buildCtx({ noPlanningList: true }));

			expect(result).toBeNull();
		});

		it('returns null when cardId is missing from payload', async () => {
			const ctx = buildCtx();
			(ctx.payload as Record<string, unknown>).action = {
				...((ctx.payload as Record<string, unknown>).action as object),
				data: { text: `@${BOT_USERNAME} hello` },
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('@mention check is case-insensitive', async () => {
			const result = await trigger.handle(
				buildCtx({ commentText: `@${BOT_USERNAME.toUpperCase()} hey` }),
			);

			expect(result).not.toBeNull();
		});

		it('handles multiple calls correctly regardless of caching state', async () => {
			// Call handle twice - both should succeed
			const result1 = await trigger.handle(buildCtx());
			const result2 = await trigger.handle(buildCtx());

			// Both should return valid results (caching doesn't break functionality)
			expect(result1).not.toBeNull();
			expect(result2).not.toBeNull();
			expect(result1?.agentType).toBe('respond-to-planning-comment');
			expect(result2?.agentType).toBe('respond-to-planning-comment');

			// getMe should have been called AT MOST once (cached after first call or cached from prior test)
			expect(mockGetMe.mock.calls.length).toBeLessThanOrEqual(1);
		});
	});
});

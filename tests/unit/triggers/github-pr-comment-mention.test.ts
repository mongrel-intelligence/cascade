import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const { mockGetPR, mockIsCascadeBot } = vi.hoisted(() => ({
	mockGetPR: vi.fn(),
	mockIsCascadeBot: vi.fn(),
}));

vi.mock('../../../src/triggers/config-resolver.js', () => ({
	isTriggerEnabled: vi.fn().mockResolvedValue(true),
	getTriggerParameters: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../src/triggers/shared/trigger-check.js', () => ({
	checkTriggerEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		getPR: mockGetPR,
	},
}));

vi.mock('../../../src/github/personas.js', () => ({
	isCascadeBot: mockIsCascadeBot,
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn(),
}));

import { lookupWorkItemForPR } from '../../../src/db/repositories/prWorkItemsRepository.js';
import { PRCommentMentionTrigger } from '../../../src/triggers/github/pr-comment-mention.js';
import { checkTriggerEnabled } from '../../../src/triggers/shared/trigger-check.js';
import type { TriggerContext } from '../../../src/triggers/types.js';
import { createMockProject } from '../../helpers/factories.js';
import {
	IMPLEMENTER_USERNAME,
	REVIEWER_USERNAME,
	mockPersonaIdentities,
} from '../../helpers/mockPersonas.js';

const HUMAN_USERNAME = 'alice-human';
const CARD_SHORT_ID = 'abc123card';
const PR_BODY_WITH_CARD = `Fixes https://trello.com/c/${CARD_SHORT_ID}/my-card`;
const PR_BODY_NO_CARD = 'This PR has no Trello card link';

const mockProject = createMockProject({
	id: 'test-project',
	name: 'Test Project',
	trello: {
		boardId: 'board-123',
		lists: { splitting: 'b', planning: 'p', todo: 't' },
		labels: {},
	},
});

/** Build an issue_comment.created payload (PR conversation comment) */
function buildIssueCommentPayload(
	overrides: {
		action?: string;
		commentBody?: string;
		commentAuthor?: string;
		commentId?: number;
		prNumber?: number;
		hasPrLink?: boolean;
	} = {},
) {
	return {
		action: overrides.action ?? 'created',
		issue: {
			number: overrides.prNumber ?? 42,
			title: 'Test PR',
			html_url: 'https://github.com/owner/repo/issues/42',
			pull_request:
				overrides.hasPrLink !== false
					? { url: 'https://api.github.com/repos/owner/repo/pulls/42' }
					: undefined,
		},
		comment: {
			id: overrides.commentId ?? 100,
			body: overrides.commentBody ?? `@${IMPLEMENTER_USERNAME} can you fix this?`,
			html_url: 'https://github.com/owner/repo/issues/42#comment-100',
			user: { login: overrides.commentAuthor ?? HUMAN_USERNAME },
		},
		repository: {
			full_name: 'owner/repo',
			html_url: 'https://github.com/owner/repo',
		},
		sender: { login: overrides.commentAuthor ?? HUMAN_USERNAME },
	};
}

/** Build a pull_request_review_comment.created payload (inline PR comment) */
function buildReviewCommentPayload(
	overrides: {
		action?: string;
		commentBody?: string;
		commentAuthor?: string;
		commentId?: number;
		prNumber?: number;
		prBranch?: string;
	} = {},
) {
	return {
		action: overrides.action ?? 'created',
		comment: {
			id: overrides.commentId ?? 200,
			body: overrides.commentBody ?? `@${IMPLEMENTER_USERNAME} what do you think?`,
			path: 'src/file.ts',
			line: 10,
			html_url: 'https://github.com/owner/repo/pull/42#discussion_r200',
			user: { login: overrides.commentAuthor ?? HUMAN_USERNAME },
		},
		pull_request: {
			number: overrides.prNumber ?? 42,
			title: 'Test PR',
			html_url: 'https://github.com/owner/repo/pull/42',
			head: { ref: overrides.prBranch ?? 'feature/test', sha: 'abc123' },
			base: { ref: 'main' },
		},
		repository: {
			full_name: 'owner/repo',
			html_url: 'https://github.com/owner/repo',
		},
		sender: { login: overrides.commentAuthor ?? HUMAN_USERNAME },
	};
}

function buildCtx(
	overrides: {
		source?: TriggerContext['source'];
		payload?: unknown;
		personaIdentities?: TriggerContext['personaIdentities'];
		noPersonaIdentities?: boolean;
	} = {},
): TriggerContext {
	return {
		project: mockProject,
		source: overrides.source ?? 'github',
		payload: overrides.payload ?? buildIssueCommentPayload(),
		personaIdentities: overrides.noPersonaIdentities
			? undefined
			: (overrides.personaIdentities ?? mockPersonaIdentities),
	};
}

describe('PRCommentMentionTrigger', () => {
	let trigger: PRCommentMentionTrigger;

	beforeEach(() => {
		vi.resetAllMocks();
		trigger = new PRCommentMentionTrigger();
		vi.mocked(checkTriggerEnabled).mockResolvedValue(true);
		mockIsCascadeBot.mockReturnValue(false);
		vi.mocked(lookupWorkItemForPR).mockResolvedValue(null);
		mockGetPR.mockResolvedValue({
			headRef: 'feature/test',
			body: PR_BODY_WITH_CARD,
		});
	});

	describe('matches', () => {
		it('matches issue_comment.created on a PR', () => {
			expect(trigger.matches(buildCtx())).toBe(true);
		});

		it('does not match issue_comment.created if not a PR (no pull_request link)', () => {
			const ctx = buildCtx({
				payload: buildIssueCommentPayload({ hasPrLink: false }),
			});
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match issue_comment.edited', () => {
			const ctx = buildCtx({
				payload: buildIssueCommentPayload({ action: 'edited' }),
			});
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('matches pull_request_review_comment.created', () => {
			const ctx = buildCtx({ payload: buildReviewCommentPayload() });
			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match pull_request_review_comment.edited', () => {
			const ctx = buildCtx({
				payload: buildReviewCommentPayload({ action: 'edited' }),
			});
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-github source', () => {
			const ctx = buildCtx({ source: 'trello' });
			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match unrelated payload structure', () => {
			const ctx = buildCtx({ payload: { action: 'opened', number: 42 } });
			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	describe('handle — disabled trigger', () => {
		it('should return null when trigger is disabled', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValueOnce(false);

			const result = await trigger.handle(buildCtx());
			expect(result).toBeNull();
			expect(checkTriggerEnabled).toHaveBeenCalledWith(
				'test-project',
				'respond-to-pr-comment',
				'scm:pr-comment-mention',
				'pr-comment-mention',
			);
		});
	});

	describe('handle — issue_comment path', () => {
		it('returns respond-to-pr-comment result when @mention is present', async () => {
			const result = await trigger.handle(buildCtx());

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('respond-to-pr-comment');
			expect(result?.workItemId).toBe(CARD_SHORT_ID);
			expect(result?.agentInput.prNumber).toBe(42);
			expect(result?.agentInput.repoFullName).toBe('owner/repo');
			expect(result?.agentInput.triggerCommentBody).toContain(`@${IMPLEMENTER_USERNAME}`);
		});

		it('returns null when no @mention of implementer', async () => {
			const result = await trigger.handle(
				buildCtx({
					payload: buildIssueCommentPayload({ commentBody: 'Just a regular comment' }),
				}),
			);

			expect(result).toBeNull();
		});

		it('returns null when persona identities are missing', async () => {
			const result = await trigger.handle(buildCtx({ noPersonaIdentities: true }));

			expect(result).toBeNull();
		});

		it('returns null when comment is from a bot persona', async () => {
			mockIsCascadeBot.mockReturnValue(true);

			const result = await trigger.handle(buildCtx());

			expect(result).toBeNull();
		});

		it('fires with workItemId undefined when PR body has no Trello card link', async () => {
			mockGetPR.mockResolvedValue({
				headRef: 'feature/test',
				body: PR_BODY_NO_CARD,
			});

			const result = await trigger.handle(buildCtx());

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('respond-to-pr-comment');
			expect(result?.workItemId).toBeUndefined();
		});

		it('fetches PR details to get branch info', async () => {
			await trigger.handle(buildCtx());

			expect(mockGetPR).toHaveBeenCalledWith('owner', 'repo', 42);
		});

		it('includes branch from fetched PR details', async () => {
			mockGetPR.mockResolvedValue({
				headRef: 'feature/my-feature',
				body: PR_BODY_WITH_CARD,
			});

			const result = await trigger.handle(buildCtx());

			expect(result?.agentInput.prBranch).toBe('feature/my-feature');
		});

		it('@mention check is case-insensitive', async () => {
			const result = await trigger.handle(
				buildCtx({
					payload: buildIssueCommentPayload({
						commentBody: `@${IMPLEMENTER_USERNAME.toUpperCase()} fix this please`,
					}),
				}),
			);

			expect(result).not.toBeNull();
		});
	});

	describe('handle — review_comment path', () => {
		it('returns respond-to-pr-comment result for inline PR comment', async () => {
			const result = await trigger.handle(buildCtx({ payload: buildReviewCommentPayload() }));

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('respond-to-pr-comment');
			expect(result?.agentInput.triggerCommentPath).toBe('src/file.ts');
		});

		it('uses PR head ref from payload for branch (not fetched)', async () => {
			mockGetPR.mockResolvedValue({
				headRef: 'should-not-be-used',
				body: PR_BODY_WITH_CARD,
			});

			const result = await trigger.handle(
				buildCtx({
					payload: buildReviewCommentPayload({ prBranch: 'feature/inline-test' }),
				}),
			);

			// For review comments, prBranch comes from payload.pull_request.head.ref
			expect(result?.agentInput.prBranch).toBe('feature/inline-test');
		});

		it('returns null when no @mention in inline comment', async () => {
			const result = await trigger.handle(
				buildCtx({
					payload: buildReviewCommentPayload({ commentBody: 'LGTM' }),
				}),
			);

			expect(result).toBeNull();
		});

		it('returns null when comment author is a bot persona (inline)', async () => {
			mockIsCascadeBot.mockReturnValue(true);

			const result = await trigger.handle(buildCtx({ payload: buildReviewCommentPayload() }));

			expect(result).toBeNull();
		});
	});
});

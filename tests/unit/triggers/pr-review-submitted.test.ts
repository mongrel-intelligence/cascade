import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRReviewSubmittedTrigger } from '../../../src/triggers/github/pr-review-submitted.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

vi.mock('../../../src/github/client.js', () => ({
	getAuthenticatedUser: vi.fn(),
	getReviewerUser: vi.fn(),
}));

import { getAuthenticatedUser, getReviewerUser } from '../../../src/github/client.js';

describe('PRReviewSubmittedTrigger', () => {
	const trigger = new PRReviewSubmittedTrigger();

	const mockProject = {
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		githubTokenEnv: 'GITHUB_TOKEN',
		trello: {
			boardId: 'board123',
			lists: {
				briefing: 'briefing-list-id',
				planning: 'planning-list-id',
				todo: 'todo-list-id',
			},
			labels: {},
		},
	};

	const makeReviewPayload = (overrides: Record<string, unknown> = {}) => ({
		action: 'submitted',
		review: {
			id: 100,
			state: 'changes_requested',
			body: 'Please fix the bug',
			html_url: 'https://github.com/owner/repo/pull/42#pullrequestreview-100',
			user: { login: 'reviewer' },
		},
		pull_request: {
			number: 42,
			title: 'Test PR',
			body: 'https://trello.com/c/abc123/card-name',
			html_url: 'https://github.com/owner/repo/pull/42',
			head: { ref: 'feature/test', sha: 'abc' },
			base: { ref: 'main' },
		},
		repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
		sender: { login: 'reviewer' },
		...overrides,
	});

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getReviewerUser).mockResolvedValue(null);
	});

	describe('matches', () => {
		it('matches submitted review with changes_requested', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload(),
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('matches submitted review with commented state', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					review: {
						id: 100,
						state: 'commented',
						body: 'Nice work',
						html_url: 'https://github.com/...',
						user: { login: 'reviewer' },
					},
				}),
			};

			expect(trigger.matches(ctx)).toBe(true);
		});

		it('does not match trello source', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'trello',
				payload: {},
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-submitted action', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({ action: 'edited' }),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match approved reviews', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					review: {
						id: 100,
						state: 'approved',
						body: 'LGTM',
						html_url: 'https://github.com/...',
						user: { login: 'reviewer' },
					},
				}),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-review payloads', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: { action: 'submitted' },
			};

			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	describe('handle', () => {
		it('returns respond-to-review result for valid review', async () => {
			vi.mocked(getAuthenticatedUser).mockResolvedValue('cascade-bot');

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toEqual({
				agentType: 'respond-to-review',
				agentInput: {
					prNumber: 42,
					prBranch: 'feature/test',
					repoFullName: 'owner/repo',
					triggerCommentId: 100,
					triggerCommentBody: 'Please fix the bug',
					triggerCommentPath: '',
					triggerCommentUrl: 'https://github.com/owner/repo/pull/42#pullrequestreview-100',
				},
				prNumber: 42,
				cardId: 'abc123',
			});
		});

		it('returns null for self-authored review', async () => {
			vi.mocked(getAuthenticatedUser).mockResolvedValue('reviewer');

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('returns null for bot user review (appended [bot])', async () => {
			vi.mocked(getAuthenticatedUser).mockResolvedValue('reviewer');

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					review: {
						id: 100,
						state: 'changes_requested',
						body: 'Fix this',
						html_url: 'https://github.com/...',
						user: { login: 'reviewer[bot]' },
					},
				}),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('triggers for reviewer-authored review (not treated as self)', async () => {
			vi.mocked(getAuthenticatedUser).mockResolvedValue('cascade-bot');
			vi.mocked(getReviewerUser).mockResolvedValue('cascade-reviewer');

			const ctx: TriggerContext = {
				project: { ...mockProject, reviewerTokenEnv: 'REVIEWER_TOKEN' },
				source: 'github',
				payload: makeReviewPayload({
					review: {
						id: 100,
						state: 'changes_requested',
						body: 'Fix this',
						html_url: 'https://github.com/owner/repo/pull/42#pullrequestreview-100',
						user: { login: 'cascade-reviewer' },
					},
				}),
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('respond-to-review');
			expect(result?.agentInput.triggerCommentBody).toBe('Fix this');
		});

		it('proceeds when getAuthenticatedUser fails', async () => {
			vi.mocked(getAuthenticatedUser).mockRejectedValue(new Error('Token error'));

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('respond-to-review');
		});

		it('returns null when PR has no Trello URL', async () => {
			vi.mocked(getAuthenticatedUser).mockResolvedValue('cascade-bot');

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					pull_request: {
						number: 42,
						title: 'Test PR',
						body: 'No Trello link',
						html_url: 'https://github.com/owner/repo/pull/42',
						head: { ref: 'feature/test', sha: 'abc' },
						base: { ref: 'main' },
					},
				}),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('uses review state as fallback when review body is null', async () => {
			vi.mocked(getAuthenticatedUser).mockResolvedValue('cascade-bot');

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewPayload({
					review: {
						id: 100,
						state: 'changes_requested',
						body: null,
						html_url: 'https://github.com/owner/repo/pull/42#pullrequestreview-100',
						user: { login: 'reviewer' },
					},
				}),
			};

			const result = await trigger.handle(ctx);

			expect(result?.agentInput.triggerCommentBody).toBe('Review: changes_requested');
		});
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRReviewCommentTrigger } from '../../../src/triggers/github/pr-review-comment.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

vi.mock('../../../src/github/client.js', () => ({
	getAuthenticatedUser: vi.fn(),
	githubClient: {
		getPR: vi.fn(),
	},
}));

import { getAuthenticatedUser, githubClient } from '../../../src/github/client.js';

describe('PRReviewCommentTrigger', () => {
	const trigger = new PRReviewCommentTrigger();

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

	const makeReviewCommentPayload = (overrides: Record<string, unknown> = {}) => ({
		action: 'created',
		comment: {
			id: 300,
			body: 'This should be refactored',
			path: 'src/index.ts',
			line: 42,
			user: { login: 'reviewer' },
			html_url: 'https://github.com/owner/repo/pull/42#discussion_r300',
		},
		pull_request: {
			number: 42,
			title: 'Test PR',
			html_url: 'https://github.com/owner/repo/pull/42',
			head: { ref: 'feature/test', sha: 'abc123' },
			base: { ref: 'main' },
		},
		repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
		sender: { login: 'reviewer' },
		...overrides,
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('matches', () => {
		it('matches created review comment', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewCommentPayload(),
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

		it('does not match edited comments', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewCommentPayload({ action: 'edited' }),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match deleted comments', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewCommentPayload({ action: 'deleted' }),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-review-comment payloads', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: { action: 'created' },
			};

			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	describe('handle', () => {
		it('returns respond-to-review result with file path', async () => {
			vi.mocked(getAuthenticatedUser).mockResolvedValue('cascade-bot');
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123/card-name',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewCommentPayload(),
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.getPR).toHaveBeenCalledWith('owner', 'repo', 42);
			expect(result).toEqual({
				agentType: 'respond-to-review',
				agentInput: {
					prNumber: 42,
					prBranch: 'feature/test',
					repoFullName: 'owner/repo',
					triggerCommentId: 300,
					triggerCommentBody: 'This should be refactored',
					triggerCommentPath: 'src/index.ts',
					triggerCommentUrl: 'https://github.com/owner/repo/pull/42#discussion_r300',
				},
				prNumber: 42,
				cardId: 'abc123',
			});
		});

		it('returns null for self-authored comment', async () => {
			vi.mocked(getAuthenticatedUser).mockResolvedValue('reviewer');

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewCommentPayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
			expect(githubClient.getPR).not.toHaveBeenCalled();
		});

		it('returns null for bot user comment', async () => {
			vi.mocked(getAuthenticatedUser).mockResolvedValue('reviewer');

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewCommentPayload({
					comment: {
						id: 300,
						body: 'Bot comment',
						path: 'src/index.ts',
						line: 42,
						user: { login: 'reviewer[bot]' },
						html_url: 'https://github.com/...',
					},
				}),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('proceeds when getAuthenticatedUser fails', async () => {
			vi.mocked(getAuthenticatedUser).mockRejectedValue(new Error('Token error'));
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'https://trello.com/c/abc123',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewCommentPayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).not.toBeNull();
			expect(result?.agentType).toBe('respond-to-review');
		});

		it('returns null when PR has no Trello URL', async () => {
			vi.mocked(getAuthenticatedUser).mockResolvedValue('cascade-bot');
			vi.mocked(githubClient.getPR).mockResolvedValue({
				number: 42,
				title: 'Test PR',
				body: 'Just a regular PR',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeReviewCommentPayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});
	});
});

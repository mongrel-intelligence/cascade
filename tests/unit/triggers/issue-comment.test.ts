import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IssueCommentTrigger } from '../../../src/triggers/github/issue-comment.js';
import type { TriggerContext } from '../../../src/triggers/types.js';

vi.mock('../../../src/github/client.js', () => ({
	getAuthenticatedUser: vi.fn(),
	githubClient: {
		getPR: vi.fn(),
	},
}));

import { getAuthenticatedUser, githubClient } from '../../../src/github/client.js';

describe('IssueCommentTrigger', () => {
	const trigger = new IssueCommentTrigger();

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

	const makeIssueCommentPayload = (overrides: Record<string, unknown> = {}) => ({
		action: 'created',
		issue: {
			number: 42,
			title: 'Test PR',
			html_url: 'https://github.com/owner/repo/pull/42',
			pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/42' },
		},
		comment: {
			id: 200,
			body: 'Please review this section',
			html_url: 'https://github.com/owner/repo/pull/42#issuecomment-200',
			user: { login: 'reviewer' },
		},
		repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
		sender: { login: 'reviewer' },
		...overrides,
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('matches', () => {
		it('matches created comment on a PR', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeIssueCommentPayload(),
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
				payload: makeIssueCommentPayload({ action: 'edited' }),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match deleted comments', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeIssueCommentPayload({ action: 'deleted' }),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match comments on regular issues (not PRs)', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeIssueCommentPayload({
					issue: {
						number: 42,
						title: 'Bug report',
						html_url: 'https://github.com/owner/repo/issues/42',
						// no pull_request field
					},
				}),
			};

			expect(trigger.matches(ctx)).toBe(false);
		});

		it('does not match non-issue-comment payloads', () => {
			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: { action: 'created' },
			};

			expect(trigger.matches(ctx)).toBe(false);
		});
	});

	describe('handle', () => {
		it('returns respond-to-review result for valid comment', async () => {
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
				payload: makeIssueCommentPayload(),
			};

			const result = await trigger.handle(ctx);

			expect(githubClient.getPR).toHaveBeenCalledWith('owner', 'repo', 42);
			expect(result).toEqual({
				agentType: 'respond-to-review',
				agentInput: {
					prNumber: 42,
					prBranch: 'feature/test',
					repoFullName: 'owner/repo',
					triggerCommentId: 200,
					triggerCommentBody: 'Please review this section',
					triggerCommentPath: '',
					triggerCommentUrl: 'https://github.com/owner/repo/pull/42#issuecomment-200',
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
				payload: makeIssueCommentPayload(),
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
				payload: makeIssueCommentPayload({
					comment: {
						id: 200,
						body: 'Automated comment',
						html_url: 'https://github.com/...',
						user: { login: 'reviewer[bot]' },
					},
				}),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});

		it('proceeds when getAuthenticatedUser fails', async () => {
			vi.mocked(getAuthenticatedUser).mockRejectedValue(new Error('Auth error'));
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
				payload: makeIssueCommentPayload(),
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
				body: 'No Trello link here',
				state: 'open',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
			});

			const ctx: TriggerContext = {
				project: mockProject,
				source: 'github',
				payload: makeIssueCommentPayload(),
			};

			const result = await trigger.handle(ctx);

			expect(result).toBeNull();
		});
	});
});

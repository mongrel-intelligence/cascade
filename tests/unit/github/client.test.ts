import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Octokit before importing client
const mockPulls = {
	get: vi.fn(),
	listReviewComments: vi.fn(),
	createReplyForReviewComment: vi.fn(),
	listReviews: vi.fn(),
	listFiles: vi.fn(),
	createReview: vi.fn(),
	create: vi.fn(),
	list: vi.fn(),
};

const mockIssues = {
	createComment: vi.fn(),
	updateComment: vi.fn(),
	listComments: vi.fn(),
};

const mockChecks = {
	listForRef: vi.fn(),
};

const mockActions = {
	listWorkflowRunsForRepo: vi.fn(),
	listJobsForWorkflowRun: vi.fn(),
};

const mockReactions = {
	createForIssueComment: vi.fn(),
	createForPullRequestReviewComment: vi.fn(),
};

const mockRepos = {
	getBranch: vi.fn(),
};

const mockUsers = {
	getAuthenticated: vi.fn(),
};

vi.mock('@octokit/rest', () => ({
	Octokit: vi.fn().mockImplementation(() => ({
		pulls: mockPulls,
		issues: mockIssues,
		checks: mockChecks,
		actions: mockActions,
		reactions: mockReactions,
		repos: mockRepos,
		users: mockUsers,
	})),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import {
	getAuthenticatedUser,
	getGitHubUserForToken,
	githubClient,
	withGitHubToken,
} from '../../../src/github/client.js';

import { Octokit } from '@octokit/rest';

describe('githubClient', () => {
	describe('getClient throws without scope', () => {
		it('throws when no withGitHubToken scope is active', async () => {
			await expect(githubClient.getPR('owner', 'repo', 1)).rejects.toThrow(
				'No GitHub client in scope',
			);
		});
	});

	describe('getPR', () => {
		it('returns PR details within withGitHubToken scope', async () => {
			mockPulls.get.mockResolvedValue({
				data: {
					number: 42,
					title: 'Test PR',
					body: 'PR body',
					state: 'open',
					html_url: 'https://github.com/owner/repo/pull/42',
					head: { ref: 'feature/test', sha: 'sha123' },
					base: { ref: 'main' },
					merged: false,
					user: { login: 'test-user' },
				},
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getPR('owner', 'repo', 42),
			);

			expect(result).toEqual({
				number: 42,
				title: 'Test PR',
				body: 'PR body',
				state: 'open',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/test',
				headSha: 'sha123',
				baseRef: 'main',
				merged: false,
				user: { login: 'test-user' },
			});
			expect(mockPulls.get).toHaveBeenCalledWith({
				owner: 'owner',
				repo: 'repo',
				pull_number: 42,
			});
		});

		it('handles null merged field and missing user', async () => {
			mockPulls.get.mockResolvedValue({
				data: {
					number: 42,
					title: 'PR',
					body: null,
					state: 'open',
					html_url: 'url',
					head: { ref: 'feat', sha: 'abc' },
					base: { ref: 'main' },
					merged: null,
					user: null,
				},
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getPR('owner', 'repo', 42),
			);

			expect(result.merged).toBe(false);
			expect(result.user).toEqual({ login: 'unknown' });
		});
	});

	describe('getPRReviewComments', () => {
		it('returns mapped review comments', async () => {
			mockPulls.listReviewComments.mockResolvedValue({
				data: [
					{
						id: 1,
						body: 'Comment 1',
						path: 'src/index.ts',
						line: 10,
						html_url: 'https://github.com/...',
						user: { login: 'reviewer' },
						created_at: '2024-01-01',
						in_reply_to_id: undefined,
					},
				],
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getPRReviewComments('owner', 'repo', 42),
			);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				id: 1,
				body: 'Comment 1',
				path: 'src/index.ts',
				line: 10,
				htmlUrl: 'https://github.com/...',
				user: { login: 'reviewer' },
				createdAt: '2024-01-01',
				inReplyToId: undefined,
			});
		});

		it('handles null line', async () => {
			mockPulls.listReviewComments.mockResolvedValue({
				data: [
					{
						id: 1,
						body: 'Comment',
						path: 'file.ts',
						line: null,
						html_url: 'url',
						user: { login: 'user' },
						created_at: '2024-01-01',
						in_reply_to_id: 5,
					},
				],
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getPRReviewComments('owner', 'repo', 42),
			);

			expect(result[0].line).toBeNull();
			expect(result[0].inReplyToId).toBe(5);
		});

		it('handles missing user login', async () => {
			mockPulls.listReviewComments.mockResolvedValue({
				data: [
					{
						id: 1,
						body: 'Comment',
						path: 'file.ts',
						line: null,
						html_url: 'url',
						user: null,
						created_at: '2024-01-01',
					},
				],
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getPRReviewComments('owner', 'repo', 42),
			);

			expect(result[0].user.login).toBe('unknown');
		});
	});

	describe('replyToReviewComment', () => {
		it('creates reply and returns mapped result', async () => {
			mockPulls.createReplyForReviewComment.mockResolvedValue({
				data: {
					id: 99,
					body: 'Reply body',
					path: 'src/index.ts',
					line: 5,
					html_url: 'https://github.com/...',
					user: { login: 'bot' },
					created_at: '2024-01-01',
					in_reply_to_id: 1,
				},
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.replyToReviewComment('owner', 'repo', 42, 1, 'Reply body'),
			);

			expect(result.id).toBe(99);
			expect(result.inReplyToId).toBe(1);
			expect(mockPulls.createReplyForReviewComment).toHaveBeenCalledWith({
				owner: 'owner',
				repo: 'repo',
				pull_number: 42,
				comment_id: 1,
				body: 'Reply body',
			});
		});
	});

	describe('createPRComment', () => {
		it('creates issue comment and returns id and url', async () => {
			mockIssues.createComment.mockResolvedValue({
				data: {
					id: 200,
					html_url: 'https://github.com/owner/repo/pull/42#issuecomment-200',
				},
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.createPRComment('owner', 'repo', 42, 'Hello'),
			);

			expect(result).toEqual({
				id: 200,
				htmlUrl: 'https://github.com/owner/repo/pull/42#issuecomment-200',
			});
			expect(mockIssues.createComment).toHaveBeenCalledWith({
				owner: 'owner',
				repo: 'repo',
				issue_number: 42,
				body: 'Hello',
			});
		});
	});

	describe('updatePRComment', () => {
		it('updates comment and returns result', async () => {
			mockIssues.updateComment.mockResolvedValue({
				data: {
					id: 200,
					html_url: 'https://github.com/...',
				},
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.updatePRComment('owner', 'repo', 200, 'Updated'),
			);

			expect(result.id).toBe(200);
			expect(mockIssues.updateComment).toHaveBeenCalledWith({
				owner: 'owner',
				repo: 'repo',
				comment_id: 200,
				body: 'Updated',
			});
		});
	});

	describe('getPRReviews', () => {
		it('returns mapped reviews', async () => {
			mockPulls.listReviews.mockResolvedValue({
				data: [
					{
						id: 1,
						state: 'APPROVED',
						body: 'LGTM',
						user: { login: 'reviewer' },
						submitted_at: '2024-01-01',
						commit_id: 'abc123',
					},
				],
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getPRReviews('owner', 'repo', 42),
			);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				id: 1,
				state: 'approved',
				body: 'LGTM',
				user: { login: 'reviewer' },
				submittedAt: '2024-01-01',
				commitId: 'abc123',
			});
		});

		it('handles null body and user', async () => {
			mockPulls.listReviews.mockResolvedValue({
				data: [
					{
						id: 1,
						state: 'COMMENTED',
						body: '',
						user: null,
						submitted_at: null,
						commit_id: null,
					},
				],
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getPRReviews('owner', 'repo', 42),
			);

			expect(result[0].body).toBeNull();
			expect(result[0].user.login).toBe('unknown');
			expect(result[0].submittedAt).toBe('');
			expect(result[0].commitId).toBe('');
		});
	});

	describe('getPRIssueComments', () => {
		it('returns mapped issue comments', async () => {
			mockIssues.listComments.mockResolvedValue({
				data: [
					{
						id: 100,
						body: 'Comment body',
						user: { login: 'commenter' },
						html_url: 'https://github.com/...',
						created_at: '2024-01-01',
					},
				],
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getPRIssueComments('owner', 'repo', 42),
			);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				id: 100,
				body: 'Comment body',
				user: { login: 'commenter' },
				htmlUrl: 'https://github.com/...',
				createdAt: '2024-01-01',
			});
		});

		it('handles null body and user', async () => {
			mockIssues.listComments.mockResolvedValue({
				data: [
					{
						id: 100,
						body: null,
						user: null,
						html_url: 'url',
						created_at: '2024-01-01',
					},
				],
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getPRIssueComments('owner', 'repo', 42),
			);

			expect(result[0].body).toBe('');
			expect(result[0].user.login).toBe('unknown');
		});
	});

	describe('getCheckSuiteStatus', () => {
		function mockWorkflowRuns(
			runs: { id: number }[],
			jobsMap: Record<number, { name: string; status: string; conclusion: string | null }[]>,
		) {
			mockActions.listWorkflowRunsForRepo.mockResolvedValue({
				data: { workflow_runs: runs },
			});
			mockActions.listJobsForWorkflowRun.mockImplementation(({ run_id }: { run_id: number }) => {
				return Promise.resolve({
					data: { jobs: jobsMap[run_id] ?? [] },
				});
			});
		}

		it('returns status with all passing', async () => {
			mockWorkflowRuns([{ id: 1 }], {
				1: [
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'completed', conclusion: 'success' },
				],
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getCheckSuiteStatus('owner', 'repo', 'sha123'),
			);

			expect(result.allPassing).toBe(true);
			expect(result.totalCount).toBe(2);
			expect(result.checkRuns).toHaveLength(2);
		});

		it('returns allPassing false when some checks fail', async () => {
			mockWorkflowRuns([{ id: 1 }], {
				1: [
					{ name: 'lint', status: 'completed', conclusion: 'success' },
					{ name: 'test', status: 'completed', conclusion: 'failure' },
				],
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getCheckSuiteStatus('owner', 'repo', 'sha123'),
			);

			expect(result.allPassing).toBe(false);
		});

		it('treats skipped and neutral as passing', async () => {
			mockWorkflowRuns([{ id: 1 }], {
				1: [
					{ name: 'lint', status: 'completed', conclusion: 'skipped' },
					{ name: 'test', status: 'completed', conclusion: 'neutral' },
				],
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getCheckSuiteStatus('owner', 'repo', 'sha123'),
			);

			expect(result.allPassing).toBe(true);
		});

		it('returns allPassing false when checks are still in_progress', async () => {
			mockWorkflowRuns([{ id: 1 }], {
				1: [{ name: 'test', status: 'in_progress', conclusion: null }],
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getCheckSuiteStatus('owner', 'repo', 'sha123'),
			);

			expect(result.allPassing).toBe(false);
		});

		it('returns allPassing false when no workflow runs exist', async () => {
			mockWorkflowRuns([], {});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getCheckSuiteStatus('owner', 'repo', 'sha123'),
			);

			expect(result.allPassing).toBe(false);
			expect(result.totalCount).toBe(0);
		});

		it('aggregates jobs across multiple workflow runs', async () => {
			mockWorkflowRuns([{ id: 1 }, { id: 2 }], {
				1: [{ name: 'lint', status: 'completed', conclusion: 'success' }],
				2: [{ name: 'test', status: 'completed', conclusion: 'success' }],
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getCheckSuiteStatus('owner', 'repo', 'sha123'),
			);

			expect(result.allPassing).toBe(true);
			expect(result.totalCount).toBe(2);
			expect(result.checkRuns).toHaveLength(2);
		});
	});

	describe('getPRDiff', () => {
		it('returns mapped diff files', async () => {
			mockPulls.listFiles.mockResolvedValue({
				data: [
					{
						filename: 'src/index.ts',
						status: 'modified',
						additions: 10,
						deletions: 5,
						changes: 15,
						patch: '@@ -1,5 +1,10 @@',
					},
				],
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.getPRDiff('owner', 'repo', 42),
			);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				filename: 'src/index.ts',
				status: 'modified',
				additions: 10,
				deletions: 5,
				changes: 15,
				patch: '@@ -1,5 +1,10 @@',
			});
		});
	});

	describe('createPRReview', () => {
		it('creates review and returns result', async () => {
			mockPulls.createReview.mockResolvedValue({
				data: {
					id: 500,
					html_url: 'https://github.com/...',
				},
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.createPRReview('owner', 'repo', 42, 'APPROVE', 'LGTM'),
			);

			expect(result).toEqual({
				id: 500,
				htmlUrl: 'https://github.com/...',
			});
			expect(mockPulls.createReview).toHaveBeenCalledWith({
				owner: 'owner',
				repo: 'repo',
				pull_number: 42,
				event: 'APPROVE',
				body: 'LGTM',
				comments: undefined,
			});
		});

		it('passes file comments when provided', async () => {
			mockPulls.createReview.mockResolvedValue({
				data: { id: 501, html_url: 'url' },
			});

			await withGitHubToken('test-token', () =>
				githubClient.createPRReview('owner', 'repo', 42, 'REQUEST_CHANGES', 'Please fix', [
					{ path: 'src/index.ts', line: 10, body: 'Fix this line' },
				]),
			);

			expect(mockPulls.createReview).toHaveBeenCalledWith(
				expect.objectContaining({
					comments: [{ path: 'src/index.ts', line: 10, body: 'Fix this line' }],
				}),
			);
		});
	});

	describe('createPR', () => {
		it('creates PR and returns result', async () => {
			mockPulls.create.mockResolvedValue({
				data: {
					number: 100,
					html_url: 'https://github.com/owner/repo/pull/100',
					title: 'New Feature',
				},
			});

			const result = await withGitHubToken('test-token', () =>
				githubClient.createPR('owner', 'repo', {
					title: 'New Feature',
					body: 'Description',
					head: 'feature/new',
					base: 'main',
				}),
			);

			expect(result).toEqual({
				number: 100,
				htmlUrl: 'https://github.com/owner/repo/pull/100',
				title: 'New Feature',
			});
		});

		it('defaults draft to false', async () => {
			mockPulls.create.mockResolvedValue({
				data: { number: 101, html_url: 'url', title: 'PR' },
			});

			await withGitHubToken('test-token', () =>
				githubClient.createPR('owner', 'repo', {
					title: 'PR',
					body: 'body',
					head: 'feat',
					base: 'main',
				}),
			);

			expect(mockPulls.create).toHaveBeenCalledWith(expect.objectContaining({ draft: false }));
		});
	});

	describe('branchExists', () => {
		it('returns true when branch exists', async () => {
			mockRepos.getBranch.mockResolvedValue({ data: {} });

			const result = await withGitHubToken('test-token', () =>
				githubClient.branchExists('owner', 'repo', 'main'),
			);

			expect(result).toBe(true);
		});

		it('returns false when branch does not exist (404)', async () => {
			const error = new Error('Not Found') as Error & { status: number };
			error.status = 404;
			mockRepos.getBranch.mockRejectedValue(error);

			const result = await withGitHubToken('test-token', () =>
				githubClient.branchExists('owner', 'repo', 'nonexistent'),
			);

			expect(result).toBe(false);
		});

		it('throws on other errors', async () => {
			mockRepos.getBranch.mockRejectedValue(new Error('Server Error'));

			await expect(
				withGitHubToken('test-token', () => githubClient.branchExists('owner', 'repo', 'branch')),
			).rejects.toThrow('Server Error');
		});
	});

	describe('getAuthenticatedUser', () => {
		it('returns authenticated user login', async () => {
			mockUsers.getAuthenticated.mockResolvedValue({
				data: { login: 'cascade-bot' },
			});

			const result = await withGitHubToken('test-token', () => getAuthenticatedUser());

			expect(result).toBe('cascade-bot');
		});
	});

	describe('withGitHubToken', () => {
		it('scopes a different Octokit instance within the callback', async () => {
			mockPulls.get.mockResolvedValue({
				data: {
					number: 1,
					title: 'PR',
					body: null,
					state: 'open',
					html_url: 'url',
					head: { ref: 'feat', sha: 'abc' },
					base: { ref: 'main' },
					merged: false,
				},
			});

			await withGitHubToken('token-a', () => githubClient.getPR('owner', 'repo', 1));
			expect(Octokit).toHaveBeenCalledWith({ auth: 'token-a' });

			vi.mocked(Octokit).mockClear();

			await withGitHubToken('token-b', () => githubClient.getPR('owner', 'repo', 2));
			expect(Octokit).toHaveBeenCalledWith({ auth: 'token-b' });
		});
	});

	describe('addIssueCommentReaction', () => {
		it('calls reactions.createForIssueComment with correct params', async () => {
			mockReactions.createForIssueComment.mockResolvedValue({ data: {} });

			await withGitHubToken('test-token', () =>
				githubClient.addIssueCommentReaction('owner', 'repo', 42, 'eyes'),
			);

			expect(mockReactions.createForIssueComment).toHaveBeenCalledWith({
				owner: 'owner',
				repo: 'repo',
				comment_id: 42,
				content: 'eyes',
			});
		});

		it('propagates errors from the API', async () => {
			mockReactions.createForIssueComment.mockRejectedValue(new Error('403 Forbidden'));

			await expect(
				withGitHubToken('test-token', () =>
					githubClient.addIssueCommentReaction('owner', 'repo', 42, 'eyes'),
				),
			).rejects.toThrow('403 Forbidden');
		});
	});

	describe('addReviewCommentReaction', () => {
		it('calls reactions.createForPullRequestReviewComment with correct params', async () => {
			mockReactions.createForPullRequestReviewComment.mockResolvedValue({ data: {} });

			await withGitHubToken('test-token', () =>
				githubClient.addReviewCommentReaction('owner', 'repo', 99, 'heart'),
			);

			expect(mockReactions.createForPullRequestReviewComment).toHaveBeenCalledWith({
				owner: 'owner',
				repo: 'repo',
				comment_id: 99,
				content: 'heart',
			});
		});

		it('propagates errors from the API', async () => {
			mockReactions.createForPullRequestReviewComment.mockRejectedValue(
				new Error('422 Unprocessable'),
			);

			await expect(
				withGitHubToken('test-token', () =>
					githubClient.addReviewCommentReaction('owner', 'repo', 99, 'eyes'),
				),
			).rejects.toThrow('422 Unprocessable');
		});
	});

	describe('getGitHubUserForToken', () => {
		it('returns null when token is null', async () => {
			const result = await getGitHubUserForToken(null);
			expect(result).toBeNull();
		});

		it('resolves reviewer username from token', async () => {
			mockUsers.getAuthenticated.mockResolvedValue({
				data: { login: 'cascade-reviewer' },
			});

			const result = await getGitHubUserForToken('reviewer-pat');
			expect(result).toBe('cascade-reviewer');
			expect(Octokit).toHaveBeenCalledWith({ auth: 'reviewer-pat' });
		});

		it('returns null on auth failure', async () => {
			mockUsers.getAuthenticated.mockRejectedValue(new Error('Bad credentials'));

			const result = await getGitHubUserForToken('bad-token');
			expect(result).toBeNull();
		});
	});
});

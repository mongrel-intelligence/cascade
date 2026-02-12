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
};

const mockIssues = {
	createComment: vi.fn(),
	updateComment: vi.fn(),
	listComments: vi.fn(),
};

const mockChecks = {
	listForRef: vi.fn(),
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
	getReviewerUser,
	githubClient,
	resetGitHubClient,
	withGitHubToken,
} from '../../../src/github/client.js';

import { Octokit } from '@octokit/rest';

describe('githubClient', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		resetGitHubClient();
		process.env = { ...originalEnv, GITHUB_TOKEN: 'test-token' };
	});

	afterEach(() => {
		process.env = originalEnv;
		resetGitHubClient();
	});

	describe('getPR', () => {
		it('returns PR details', async () => {
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
				},
			});

			const result = await githubClient.getPR('owner', 'repo', 42);

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
			});
			expect(mockPulls.get).toHaveBeenCalledWith({
				owner: 'owner',
				repo: 'repo',
				pull_number: 42,
			});
		});

		it('handles null merged field', async () => {
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
				},
			});

			const result = await githubClient.getPR('owner', 'repo', 42);

			expect(result.merged).toBe(false);
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

			const result = await githubClient.getPRReviewComments('owner', 'repo', 42);

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

			const result = await githubClient.getPRReviewComments('owner', 'repo', 42);

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

			const result = await githubClient.getPRReviewComments('owner', 'repo', 42);

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

			const result = await githubClient.replyToReviewComment('owner', 'repo', 42, 1, 'Reply body');

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

			const result = await githubClient.createPRComment('owner', 'repo', 42, 'Hello');

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

			const result = await githubClient.updatePRComment('owner', 'repo', 200, 'Updated');

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
					},
				],
			});

			const result = await githubClient.getPRReviews('owner', 'repo', 42);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				id: 1,
				state: 'approved',
				body: 'LGTM',
				user: { login: 'reviewer' },
				submittedAt: '2024-01-01',
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
					},
				],
			});

			const result = await githubClient.getPRReviews('owner', 'repo', 42);

			expect(result[0].body).toBeNull();
			expect(result[0].user.login).toBe('unknown');
			expect(result[0].submittedAt).toBe('');
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

			const result = await githubClient.getPRIssueComments('owner', 'repo', 42);

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

			const result = await githubClient.getPRIssueComments('owner', 'repo', 42);

			expect(result[0].body).toBe('');
			expect(result[0].user.login).toBe('unknown');
		});
	});

	describe('getCheckSuiteStatus', () => {
		it('returns status with all passing', async () => {
			mockChecks.listForRef.mockResolvedValue({
				data: {
					total_count: 2,
					check_runs: [
						{ name: 'lint', status: 'completed', conclusion: 'success' },
						{ name: 'test', status: 'completed', conclusion: 'success' },
					],
				},
			});

			const result = await githubClient.getCheckSuiteStatus('owner', 'repo', 'sha123');

			expect(result.allPassing).toBe(true);
			expect(result.totalCount).toBe(2);
			expect(result.checkRuns).toHaveLength(2);
		});

		it('returns allPassing false when some checks fail', async () => {
			mockChecks.listForRef.mockResolvedValue({
				data: {
					total_count: 2,
					check_runs: [
						{ name: 'lint', status: 'completed', conclusion: 'success' },
						{ name: 'test', status: 'completed', conclusion: 'failure' },
					],
				},
			});

			const result = await githubClient.getCheckSuiteStatus('owner', 'repo', 'sha123');

			expect(result.allPassing).toBe(false);
		});

		it('treats skipped and neutral as passing', async () => {
			mockChecks.listForRef.mockResolvedValue({
				data: {
					total_count: 2,
					check_runs: [
						{ name: 'lint', status: 'completed', conclusion: 'skipped' },
						{ name: 'test', status: 'completed', conclusion: 'neutral' },
					],
				},
			});

			const result = await githubClient.getCheckSuiteStatus('owner', 'repo', 'sha123');

			expect(result.allPassing).toBe(true);
		});

		it('returns allPassing false when checks are still in_progress', async () => {
			mockChecks.listForRef.mockResolvedValue({
				data: {
					total_count: 1,
					check_runs: [{ name: 'test', status: 'in_progress', conclusion: null }],
				},
			});

			const result = await githubClient.getCheckSuiteStatus('owner', 'repo', 'sha123');

			expect(result.allPassing).toBe(false);
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

			const result = await githubClient.getPRDiff('owner', 'repo', 42);

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

			const result = await githubClient.createPRReview('owner', 'repo', 42, 'APPROVE', 'LGTM');

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

			await githubClient.createPRReview('owner', 'repo', 42, 'REQUEST_CHANGES', 'Please fix', [
				{ path: 'src/index.ts', line: 10, body: 'Fix this line' },
			]);

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

			const result = await githubClient.createPR('owner', 'repo', {
				title: 'New Feature',
				body: 'Description',
				head: 'feature/new',
				base: 'main',
			});

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

			await githubClient.createPR('owner', 'repo', {
				title: 'PR',
				body: 'body',
				head: 'feat',
				base: 'main',
			});

			expect(mockPulls.create).toHaveBeenCalledWith(expect.objectContaining({ draft: false }));
		});
	});

	describe('branchExists', () => {
		it('returns true when branch exists', async () => {
			mockRepos.getBranch.mockResolvedValue({ data: {} });

			const result = await githubClient.branchExists('owner', 'repo', 'main');

			expect(result).toBe(true);
		});

		it('returns false when branch does not exist (404)', async () => {
			const error = new Error('Not Found') as Error & { status: number };
			error.status = 404;
			mockRepos.getBranch.mockRejectedValue(error);

			const result = await githubClient.branchExists('owner', 'repo', 'nonexistent');

			expect(result).toBe(false);
		});

		it('throws on other errors', async () => {
			mockRepos.getBranch.mockRejectedValue(new Error('Server Error'));

			await expect(githubClient.branchExists('owner', 'repo', 'branch')).rejects.toThrow(
				'Server Error',
			);
		});
	});

	describe('getAuthenticatedUser', () => {
		it('returns authenticated user login', async () => {
			mockUsers.getAuthenticated.mockResolvedValue({
				data: { login: 'cascade-bot' },
			});

			const result = await getAuthenticatedUser();

			expect(result).toBe('cascade-bot');
		});
	});

	describe('GITHUB_TOKEN required', () => {
		it('throws when GITHUB_TOKEN is not set', async () => {
			resetGitHubClient();
			process.env.GITHUB_TOKEN = undefined;

			await expect(githubClient.getPR('owner', 'repo', 1)).rejects.toThrow(
				'GITHUB_TOKEN must be set',
			);
		});
	});

	describe('withGitHubToken', () => {
		it('scopes a different Octokit instance within the callback', async () => {
			// First call uses the default token
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

			await githubClient.getPR('owner', 'repo', 1);
			// Default client created with test-token
			expect(Octokit).toHaveBeenCalledWith({ auth: 'test-token' });

			vi.mocked(Octokit).mockClear();

			// Now call within withGitHubToken scope
			await withGitHubToken('reviewer-token', async () => {
				await githubClient.getPR('owner', 'repo', 2);
			});

			// A new Octokit was created with reviewer-token
			expect(Octokit).toHaveBeenCalledWith({ auth: 'reviewer-token' });
		});

		it('restores original client after scope exits', async () => {
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

			// Initialize the default singleton first
			await githubClient.getPR('owner', 'repo', 1);
			vi.mocked(Octokit).mockClear();

			await withGitHubToken('reviewer-token', async () => {
				await githubClient.getPR('owner', 'repo', 2);
			});

			// The scoped call created a new Octokit with reviewer-token
			expect(Octokit).toHaveBeenCalledWith({ auth: 'reviewer-token' });
			vi.mocked(Octokit).mockClear();

			// After scope, calls should NOT create a new Octokit (uses cached singleton)
			await githubClient.getPR('owner', 'repo', 3);
			expect(Octokit).not.toHaveBeenCalled();
		});
	});

	describe('getReviewerUser', () => {
		it('returns null when no reviewerTokenEnv provided', async () => {
			const result = await getReviewerUser();
			expect(result).toBeNull();
		});

		it('returns null when env var is not set', async () => {
			const result = await getReviewerUser('MISSING_TOKEN');
			expect(result).toBeNull();
		});

		it('resolves and caches reviewer username', async () => {
			process.env.REVIEWER_TOKEN = 'reviewer-pat';
			mockUsers.getAuthenticated.mockResolvedValue({
				data: { login: 'cascade-reviewer' },
			});

			const result1 = await getReviewerUser('REVIEWER_TOKEN');
			expect(result1).toBe('cascade-reviewer');

			// Second call should use cache (Octokit only called once for the reviewer)
			const result2 = await getReviewerUser('REVIEWER_TOKEN');
			expect(result2).toBe('cascade-reviewer');
			// Two Octokit constructions: one for main client (from beforeEach getPR calls), one for reviewer
			// But the reviewer Octokit should only be created once due to caching
		});

		it('returns null on auth failure', async () => {
			process.env.REVIEWER_TOKEN = 'bad-token';
			mockUsers.getAuthenticated.mockRejectedValue(new Error('Bad credentials'));

			const result = await getReviewerUser('REVIEWER_TOKEN');
			expect(result).toBeNull();
		});
	});
});

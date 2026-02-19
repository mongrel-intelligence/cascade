import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock config provider
vi.mock('../../../src/config/provider.js', () => ({
	getProjectSecret: vi.fn(),
	findProjectByRepo: vi.fn(),
}));

// Mock getProjectGitHubToken
vi.mock('../../../src/config/projects.js', () => ({
	getProjectGitHubToken: vi.fn(),
}));

// Mock config cache (imported transitively)
vi.mock('../../../src/config/configCache.js', () => ({
	configCache: {
		getSecrets: vi.fn().mockReturnValue(null),
		getConfig: vi.fn().mockReturnValue(null),
		getProjectByBoardId: vi.fn().mockReturnValue(null),
		getProjectByRepo: vi.fn().mockReturnValue(null),
		setConfig: vi.fn(),
		setProjectByBoardId: vi.fn(),
		setProjectByRepo: vi.fn(),
		setSecrets: vi.fn(),
		invalidate: vi.fn(),
	},
}));

import { getProjectGitHubToken } from '../../../src/config/projects.js';
import { findProjectByRepo, getProjectSecret } from '../../../src/config/provider.js';
import { _resetJiraCloudIdCache, sendAcknowledgeReaction } from '../../../src/router/reactions.js';

const mockGetProjectSecret = vi.mocked(getProjectSecret);
const mockGetProjectGitHubToken = vi.mocked(getProjectGitHubToken);
const mockFindProjectByRepo = vi.mocked(findProjectByRepo);

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const PROJECT_ID = 'test-project';
const REPO_FULL_NAME = 'owner/repo';

const TRELLO_COMMENT_PAYLOAD = {
	model: { id: 'board123', name: 'Test Board' },
	action: {
		id: 'action123',
		type: 'commentCard',
		data: { card: { id: 'card123', name: 'Test Card', idShort: 1, shortLink: 'abc' } },
	},
};

const GITHUB_ISSUE_COMMENT_PAYLOAD = {
	action: 'created',
	issue: { number: 42, title: 'Test Issue', html_url: 'https://github.com/owner/repo/issues/42' },
	comment: {
		id: 99,
		body: 'Hello',
		html_url: 'https://github.com/owner/repo/issues/42#issuecomment-99',
		user: { login: 'user' },
	},
	repository: { full_name: REPO_FULL_NAME, html_url: 'https://github.com/owner/repo' },
	sender: { login: 'user' },
};

const GITHUB_PR_REVIEW_COMMENT_PAYLOAD = {
	action: 'created',
	pull_request: {
		number: 7,
		title: 'My PR',
		html_url: 'https://github.com/owner/repo/pull/7',
		head: { ref: 'feature/x', sha: 'abc' },
		base: { ref: 'main' },
	},
	comment: {
		id: 55,
		body: 'Review comment',
		path: 'src/file.ts',
		line: 10,
		user: { login: 'reviewer' },
		html_url: 'https://github.com/owner/repo/pull/7#issuecomment-55',
	},
	repository: { full_name: REPO_FULL_NAME, html_url: 'https://github.com/owner/repo' },
	sender: { login: 'reviewer' },
};

const JIRA_COMMENT_PAYLOAD = {
	webhookEvent: 'comment_created',
	issue: { id: 'issue-id-123', key: 'PROJ-42' },
	comment: { id: 'comment-id-456' },
};

describe('sendAcknowledgeReaction', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		_resetJiraCloudIdCache();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		// Default credential mocks
		mockGetProjectSecret.mockImplementation(async (_projectId, key) => {
			if (key === 'TRELLO_API_KEY') return 'test-trello-key';
			if (key === 'TRELLO_TOKEN') return 'test-trello-token';
			if (key === 'JIRA_EMAIL') return 'bot@example.com';
			if (key === 'JIRA_API_TOKEN') return 'test-jira-token';
			if (key === 'JIRA_BASE_URL') return 'https://test.atlassian.net';
			throw new Error(`Secret '${key}' not found`);
		});

		mockGetProjectGitHubToken.mockResolvedValue('test-github-token');

		mockFindProjectByRepo.mockResolvedValue({
			id: PROJECT_ID,
			name: 'Test',
			repo: REPO_FULL_NAME,
			baseBranch: 'main',
			branchPrefix: 'feature/',
			trello: { boardId: 'b1', lists: {}, labels: {} },
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// -------------------------------------------------------------------------
	// Trello
	// -------------------------------------------------------------------------

	describe('Trello reactions', () => {
		it('sends 💭 reaction for commentCard action', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true });

			await sendAcknowledgeReaction('trello', PROJECT_ID, TRELLO_COMMENT_PAYLOAD);

			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toContain('https://api.trello.com/1/actions/action123/reactions');
			expect(url).toContain('key=test-trello-key');
			expect(url).toContain('token=test-trello-token');
			expect(options.method).toBe('POST');
			const body = JSON.parse(options.body);
			expect(body.shortName).toBe('thought_balloon');
			expect(body.native).toBe('💭');
		});

		it('skips reaction for non-commentCard Trello action', async () => {
			const payload = {
				model: { id: 'board123', name: 'Test Board' },
				action: { id: 'action456', type: 'updateCard', data: {} },
			};

			await sendAcknowledgeReaction('trello', PROJECT_ID, payload);

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('skips reaction when Trello credentials are missing', async () => {
			mockGetProjectSecret.mockRejectedValue(new Error('Secret not found'));

			await sendAcknowledgeReaction('trello', PROJECT_ID, TRELLO_COMMENT_PAYLOAD);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('Missing Trello credentials'),
			);
		});

		it('logs warning on Trello API error but does not throw', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: async () => 'Unauthorized',
			});

			await expect(
				sendAcknowledgeReaction('trello', PROJECT_ID, TRELLO_COMMENT_PAYLOAD),
			).resolves.toBeUndefined();

			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('Trello reaction failed'),
				401,
				'Unauthorized',
			);
		});

		it('skips non-comment actions without fetching credentials', async () => {
			const payload = {
				model: { id: 'board123', name: 'Test Board' },
				action: { id: 'a1', type: 'addLabelToCard', data: {} },
			};

			await sendAcknowledgeReaction('trello', PROJECT_ID, payload);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(mockGetProjectSecret).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------------
	// GitHub
	// -------------------------------------------------------------------------

	describe('GitHub reactions', () => {
		it('sends 👀 reaction on issue_comment payload', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true });

			await sendAcknowledgeReaction('github', REPO_FULL_NAME, GITHUB_ISSUE_COMMENT_PAYLOAD);

			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toBe('https://api.github.com/repos/owner/repo/issues/comments/99/reactions');
			expect(options.method).toBe('POST');
			expect(options.headers.Authorization).toBe('Bearer test-github-token');
			expect(JSON.parse(options.body)).toEqual({ content: 'eyes' });
		});

		it('sends 👀 reaction on pull_request_review_comment payload', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true });

			await sendAcknowledgeReaction('github', REPO_FULL_NAME, GITHUB_PR_REVIEW_COMMENT_PAYLOAD);

			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toBe('https://api.github.com/repos/owner/repo/pulls/comments/55/reactions');
			expect(options.method).toBe('POST');
			expect(JSON.parse(options.body)).toEqual({ content: 'eyes' });
		});

		it('skips reaction for non-comment GitHub events (e.g. check_suite)', async () => {
			const payload = {
				action: 'completed',
				check_suite: { id: 1, status: 'completed', conclusion: 'success', pull_requests: [] },
				repository: { full_name: REPO_FULL_NAME },
			};

			await sendAcknowledgeReaction('github', REPO_FULL_NAME, payload);

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('skips reaction for pull_request event (no comment)', async () => {
			const payload = {
				action: 'opened',
				number: 10,
				pull_request: {
					number: 10,
					title: 'PR',
					head: { ref: 'f', sha: 'x' },
					base: { ref: 'main' },
				},
				repository: { full_name: REPO_FULL_NAME },
			};

			await sendAcknowledgeReaction('github', REPO_FULL_NAME, payload);

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('skips reaction when project not found for repo', async () => {
			mockFindProjectByRepo.mockResolvedValueOnce(undefined);

			await sendAcknowledgeReaction('github', REPO_FULL_NAME, GITHUB_ISSUE_COMMENT_PAYLOAD);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('No project found for repo'),
				expect.objectContaining({ repoFullName: REPO_FULL_NAME }),
			);
		});

		it('skips reaction when GitHub token is missing', async () => {
			mockGetProjectGitHubToken.mockRejectedValueOnce(new Error('Missing GITHUB_TOKEN'));

			await sendAcknowledgeReaction('github', REPO_FULL_NAME, GITHUB_ISSUE_COMMENT_PAYLOAD);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Missing GitHub token'));
		});

		it('logs warning on GitHub API error but does not throw', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 403,
				text: async () => 'Forbidden',
			});

			await expect(
				sendAcknowledgeReaction('github', REPO_FULL_NAME, GITHUB_ISSUE_COMMENT_PAYLOAD),
			).resolves.toBeUndefined();

			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('GitHub reaction failed'),
				403,
				'Forbidden',
			);
		});
	});

	// -------------------------------------------------------------------------
	// JIRA
	// -------------------------------------------------------------------------

	describe('JIRA reactions', () => {
		it('sends 💭 reaction via reactions API when cloudId is available', async () => {
			// First fetch: tenant_info → cloudId
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ cloudId: 'cloud-abc' }),
			});
			// Second fetch: PUT reaction
			mockFetch.mockResolvedValueOnce({ ok: true });

			await sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD);

			expect(mockFetch).toHaveBeenCalledTimes(2);

			const [tenantUrl] = mockFetch.mock.calls[0];
			expect(tenantUrl).toBe('https://test.atlassian.net/_edge/tenant_info');

			const [reactionUrl, reactionOptions] = mockFetch.mock.calls[1];
			expect(reactionUrl).toContain('/rest/reactions/1.0/reactions/');
			expect(reactionUrl).toContain('cloud-abc');
			expect(reactionUrl).toContain('issue-id-123');
			expect(reactionUrl).toContain('comment-id-456');
			expect(reactionUrl).toContain('atlassian-thought_balloon');
			expect(reactionOptions.method).toBe('PUT');
			expect(reactionOptions.headers.Authorization).toMatch(/^Basic /);
		});

		it('caches cloudId between calls', async () => {
			// First call: tenant_info + reaction
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ cloudId: 'cloud-xyz' }),
			});
			mockFetch.mockResolvedValueOnce({ ok: true });

			await sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD);

			// Second call: only reaction (cloudId cached)
			mockFetch.mockResolvedValueOnce({ ok: true });
			await sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD);

			// tenant_info called only once across both reaction calls
			const tenantCalls = mockFetch.mock.calls.filter(([url]) =>
				(url as string).includes('tenant_info'),
			);
			expect(tenantCalls).toHaveLength(1);
		});

		it('skips gracefully when reactions API fails (no fallback comment)', async () => {
			// tenant_info
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ cloudId: 'cloud-abc' }),
			});
			// reactions API fails
			mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

			await sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD);

			// Only 2 calls: tenant_info + reactions API. No fallback comment.
			expect(mockFetch).toHaveBeenCalledTimes(2);
			const fallbackCall = mockFetch.mock.calls.find(([url]) =>
				(url as string).includes('/rest/api/2/issue/'),
			);
			expect(fallbackCall).toBeUndefined();
		});

		it('skips gracefully when cloudId fetch fails (no fallback comment)', async () => {
			// tenant_info fetch fails (network error)
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			await sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD);

			// Only 1 call: tenant_info. No fallback comment posted.
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('skips reaction when issue.id or comment.id are missing', async () => {
			const payload = { webhookEvent: 'jira:issue_updated', issue: { id: 'x' } }; // no comment

			await sendAcknowledgeReaction('jira', PROJECT_ID, payload);

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('skips reaction when JIRA credentials are missing', async () => {
			mockGetProjectSecret.mockRejectedValue(new Error('Secret not found'));

			await sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD);

			expect(mockFetch).not.toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('Missing JIRA credentials'),
			);
		});

		it('does not throw when credentials are missing', async () => {
			mockGetProjectSecret.mockRejectedValue(new Error('Secret not found'));

			await expect(
				sendAcknowledgeReaction('jira', PROJECT_ID, JIRA_COMMENT_PAYLOAD),
			).resolves.toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Error handling (top-level)
	// -------------------------------------------------------------------------

	describe('error handling', () => {
		it('catches unexpected errors without throwing', async () => {
			// Make getProjectSecret throw unexpectedly inside the inner try block
			mockGetProjectSecret.mockImplementation(() => {
				throw new Error('Unexpected sync error');
			});

			await expect(
				sendAcknowledgeReaction('trello', PROJECT_ID, TRELLO_COMMENT_PAYLOAD),
			).resolves.toBeUndefined();
		});
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock config provider for DB secret resolution
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn(),
	findProjectByRepo: vi.fn(),
	findProjectById: vi.fn(),
}));

// Mock getProjectGitHubToken
vi.mock('../../../src/config/projects.js', () => ({
	getProjectGitHubToken: vi.fn(),
}));

// Mock config cache (imported transitively)
vi.mock('../../../src/config/configCache.js', () => ({
	configCache: {
		getConfig: vi.fn().mockReturnValue(null),
		getProjectByBoardId: vi.fn().mockReturnValue(null),
		getProjectByRepo: vi.fn().mockReturnValue(null),
		setConfig: vi.fn(),
		setProjectByBoardId: vi.fn(),
		setProjectByRepo: vi.fn(),
		invalidate: vi.fn(),
	},
}));

import { getProjectGitHubToken } from '../../../src/config/projects.js';
import {
	findProjectById,
	findProjectByRepo,
	getIntegrationCredential,
} from '../../../src/config/provider.js';
import {
	deleteGitHubAck,
	deleteJiraAck,
	deleteTrelloAck,
	postGitHubAck,
	postJiraAck,
	postTrelloAck,
	resolveGitHubTokenForAck,
} from '../../../src/router/acknowledgments.js';

const mockGetIntegrationCredential = vi.mocked(getIntegrationCredential);
const mockGetProjectGitHubToken = vi.mocked(getProjectGitHubToken);
const mockFindProjectByRepo = vi.mocked(findProjectByRepo);
const mockFindProjectById = vi.mocked(findProjectById);

const MOCK_CREDENTIALS: Record<string, string> = {
	'pm/api_key': 'test-trello-key',
	'pm/token': 'test-trello-token',
	'pm/email': 'bot@example.com',
	'pm/api_token': 'test-jira-token',
};

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
	mockFetch.mockReset();
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});

	mockGetIntegrationCredential.mockImplementation(async (_projectId, category, role) => {
		const value = MOCK_CREDENTIALS[`${category}/${role}`];
		if (value) return value;
		throw new Error(`Credential '${category}/${role}' not found`);
	});
	mockGetProjectGitHubToken.mockResolvedValue('test-github-token');
	mockFindProjectByRepo.mockResolvedValue({
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: { boardId: 'b1', lists: {}, labels: {} },
	});
	mockFindProjectById.mockResolvedValue({
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		jira: {
			baseUrl: 'https://test.atlassian.net',
			projectKey: 'PROJ',
			statuses: {},
			labels: {},
		},
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('postTrelloAck', () => {
	it('posts a comment and returns the comment ID', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ id: 'comment-123' }),
		});

		const result = await postTrelloAck('test', 'card1', 'Hello');

		expect(result).toBe('comment-123');
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toContain('https://api.trello.com/1/cards/card1/actions/comments');
		expect(url).toContain('key=test-trello-key');
		expect(url).toContain('token=test-trello-token');
		expect(options.method).toBe('POST');
		expect(JSON.parse(options.body)).toEqual({ text: 'Hello' });
	});

	it('returns null when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await postTrelloAck('test', 'card1', 'Hello');

		expect(result).toBeNull();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('returns null on API error', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			text: async () => 'Unauthorized',
		});

		const result = await postTrelloAck('test', 'card1', 'Hello');

		expect(result).toBeNull();
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('Trello comment failed'),
			401,
			'Unauthorized',
		);
	});

	it('returns null when response has no id', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({}),
		});

		const result = await postTrelloAck('test', 'card1', 'Hello');

		expect(result).toBeNull();
	});
});

describe('deleteTrelloAck', () => {
	it('sends DELETE request to remove comment', async () => {
		mockFetch.mockResolvedValueOnce({ ok: true });

		await deleteTrelloAck('test', 'card1', 'comment-123');

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toContain('https://api.trello.com/1/cards/card1/actions/comment-123/comments');
		expect(options.method).toBe('DELETE');
	});

	it('silently returns when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		await deleteTrelloAck('test', 'card1', 'comment-123');

		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('catches fetch errors gracefully', async () => {
		mockFetch.mockRejectedValueOnce(new Error('Network error'));

		await deleteTrelloAck('test', 'card1', 'comment-123');

		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('Failed to delete Trello orphan ack'),
			expect.any(String),
		);
	});
});

describe('postGitHubAck', () => {
	it('posts a comment and returns the comment ID', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ id: 42 }),
		});

		const result = await postGitHubAck('owner/repo', 5, 'Looking into it...', 'ghp_token');

		expect(result).toBe(42);
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('https://api.github.com/repos/owner/repo/issues/5/comments');
		expect(options.method).toBe('POST');
		expect(options.headers.Authorization).toBe('Bearer ghp_token');
		expect(JSON.parse(options.body)).toEqual({ body: 'Looking into it...' });
	});

	it('returns null on API error', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 403,
			text: async () => 'Forbidden',
		});

		const result = await postGitHubAck('owner/repo', 5, 'Hello', 'ghp_token');

		expect(result).toBeNull();
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('GitHub comment failed'),
			403,
			'Forbidden',
		);
	});

	it('returns null when response has no id', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({}),
		});

		const result = await postGitHubAck('owner/repo', 5, 'Hello', 'ghp_token');

		expect(result).toBeNull();
	});
});

describe('deleteGitHubAck', () => {
	it('sends DELETE request to remove comment', async () => {
		mockFetch.mockResolvedValueOnce({ ok: true });

		await deleteGitHubAck('owner/repo', 42, 'ghp_token');

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('https://api.github.com/repos/owner/repo/issues/comments/42');
		expect(options.method).toBe('DELETE');
		expect(options.headers.Authorization).toBe('Bearer ghp_token');
	});

	it('catches fetch errors gracefully', async () => {
		mockFetch.mockRejectedValueOnce(new Error('Network error'));

		await deleteGitHubAck('owner/repo', 42, 'ghp_token');

		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('Failed to delete GitHub orphan ack'),
			expect.any(String),
		);
	});
});

describe('postJiraAck', () => {
	it('posts a comment and returns the comment ID', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ id: 'jira-comment-456' }),
		});

		const result = await postJiraAck('test', 'PROJ-42', 'Working on it...');

		expect(result).toBe('jira-comment-456');
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('https://test.atlassian.net/rest/api/2/issue/PROJ-42/comment');
		expect(options.method).toBe('POST');
		expect(options.headers.Authorization).toMatch(/^Basic /);
		expect(JSON.parse(options.body)).toEqual({ body: 'Working on it...' });
	});

	it('returns null when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await postJiraAck('test', 'PROJ-42', 'Hello');

		expect(result).toBeNull();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('returns null when JIRA base URL is missing', async () => {
		mockFindProjectById.mockResolvedValue({
			id: 'test',
			name: 'Test',
			repo: 'owner/repo',
			baseBranch: 'main',
			branchPrefix: 'feature/',
		});

		const result = await postJiraAck('test', 'PROJ-42', 'Hello');

		expect(result).toBeNull();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('returns null on API error', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			text: async () => 'Unauthorized',
		});

		const result = await postJiraAck('test', 'PROJ-42', 'Hello');

		expect(result).toBeNull();
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('JIRA comment failed'),
			401,
			'Unauthorized',
		);
	});
});

describe('deleteJiraAck', () => {
	it('sends DELETE request to remove comment', async () => {
		mockFetch.mockResolvedValueOnce({ ok: true });

		await deleteJiraAck('test', 'PROJ-42', 'jira-comment-456');

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe(
			'https://test.atlassian.net/rest/api/2/issue/PROJ-42/comment/jira-comment-456',
		);
		expect(options.method).toBe('DELETE');
		expect(options.headers.Authorization).toMatch(/^Basic /);
	});

	it('silently returns when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		await deleteJiraAck('test', 'PROJ-42', 'jira-comment-456');

		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('catches fetch errors gracefully', async () => {
		mockFetch.mockRejectedValueOnce(new Error('Network error'));

		await deleteJiraAck('test', 'PROJ-42', 'jira-comment-456');

		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('Failed to delete JIRA orphan ack'),
			expect.any(String),
		);
	});
});

describe('resolveGitHubTokenForAck', () => {
	it('returns token and project when both are found', async () => {
		const result = await resolveGitHubTokenForAck('owner/repo');

		expect(result).not.toBeNull();
		expect(result?.token).toBe('test-github-token');
		expect(result?.project.id).toBe('test');
	});

	it('returns null when project is not found', async () => {
		mockFindProjectByRepo.mockResolvedValue(undefined);

		const result = await resolveGitHubTokenForAck('unknown/repo');

		expect(result).toBeNull();
	});

	it('returns null when GitHub token is missing', async () => {
		mockGetProjectGitHubToken.mockRejectedValue(new Error('Missing token'));

		const result = await resolveGitHubTokenForAck('owner/repo');

		expect(result).toBeNull();
	});
});

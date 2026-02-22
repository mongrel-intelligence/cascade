import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock config provider
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn(),
	findProjectById: vi.fn(),
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

import { findProjectById, getIntegrationCredential } from '../../../src/config/provider.js';
import {
	postGitHubComment,
	postJiraComment,
	postTrelloComment,
	resolveGitHubHeaders,
	resolveJiraCredentials,
	resolveTrelloCredentials,
} from '../../../src/router/platformClients.js';

const mockGetIntegrationCredential = vi.mocked(getIntegrationCredential);
const mockFindProjectById = vi.mocked(findProjectById);

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const MOCK_CREDENTIALS: Record<string, string> = {
	'pm/api_key': 'trello-key',
	'pm/token': 'trello-token',
	'pm/email': 'bot@example.com',
	'pm/api_token': 'jira-api-token',
};

const MOCK_PROJECT_WITH_JIRA = {
	id: 'proj1',
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
};

beforeEach(() => {
	mockFetch.mockReset();
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});

	mockGetIntegrationCredential.mockImplementation(async (_projectId, category, role) => {
		const value = MOCK_CREDENTIALS[`${category}/${role}`];
		if (value) return value;
		throw new Error(`Credential '${category}/${role}' not found`);
	});
	mockFindProjectById.mockResolvedValue(MOCK_PROJECT_WITH_JIRA);
});

// ---------------------------------------------------------------------------
// resolveTrelloCredentials
// ---------------------------------------------------------------------------

describe('resolveTrelloCredentials', () => {
	it('returns apiKey and token on success', async () => {
		const result = await resolveTrelloCredentials('proj1');

		expect(result).not.toBeNull();
		expect(result?.apiKey).toBe('trello-key');
		expect(result?.token).toBe('trello-token');
	});

	it('returns null when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await resolveTrelloCredentials('proj1');

		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// resolveJiraCredentials
// ---------------------------------------------------------------------------

describe('resolveJiraCredentials', () => {
	it('returns email, apiToken, baseUrl, and pre-computed auth on success', async () => {
		const result = await resolveJiraCredentials('proj1');

		expect(result).not.toBeNull();
		expect(result?.email).toBe('bot@example.com');
		expect(result?.apiToken).toBe('jira-api-token');
		expect(result?.baseUrl).toBe('https://test.atlassian.net');
		// auth is base64 of email:apiToken
		const expected = Buffer.from('bot@example.com:jira-api-token').toString('base64');
		expect(result?.auth).toBe(expected);
	});

	it('returns null when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await resolveJiraCredentials('proj1');

		expect(result).toBeNull();
	});

	it('returns null when project has no JIRA base URL', async () => {
		mockFindProjectById.mockResolvedValue({
			id: 'proj1',
			name: 'Test',
			repo: 'owner/repo',
			baseBranch: 'main',
			branchPrefix: 'feature/',
		});

		const result = await resolveJiraCredentials('proj1');

		expect(result).toBeNull();
	});

	it('returns null when project is not found', async () => {
		mockFindProjectById.mockResolvedValue(undefined);

		const result = await resolveJiraCredentials('proj1');

		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// resolveGitHubHeaders
// ---------------------------------------------------------------------------

describe('resolveGitHubHeaders', () => {
	it('returns standard GitHub API headers', () => {
		const headers = resolveGitHubHeaders('ghp_token');

		expect(headers).toEqual({
			Authorization: 'Bearer ghp_token',
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
		});
	});

	it('merges extra headers without overwriting standard ones', () => {
		const headers = resolveGitHubHeaders('ghp_token', { 'Content-Type': 'application/json' });

		expect(headers['Content-Type']).toBe('application/json');
		expect(headers.Authorization).toBe('Bearer ghp_token');
	});

	it('allows overriding standard headers with extra', () => {
		const headers = resolveGitHubHeaders('ghp_token', { Accept: 'text/plain' });

		expect(headers.Accept).toBe('text/plain');
	});
});

// ---------------------------------------------------------------------------
// postTrelloComment
// ---------------------------------------------------------------------------

describe('postTrelloComment', () => {
	it('posts a comment and returns the comment ID', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ id: 'comment-abc' }),
		});

		const result = await postTrelloComment('proj1', 'card1', 'Hello!');

		expect(result).toBe('comment-abc');
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toContain('https://api.trello.com/1/cards/card1/actions/comments');
		expect(url).toContain('key=trello-key');
		expect(url).toContain('token=trello-token');
		expect(options.method).toBe('POST');
		expect(JSON.parse(options.body)).toEqual({ text: 'Hello!' });
	});

	it('returns null when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await postTrelloComment('proj1', 'card1', 'Hello!');

		expect(result).toBeNull();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('returns null on API failure', async () => {
		mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

		const result = await postTrelloComment('proj1', 'card1', 'Hello!');

		expect(result).toBeNull();
	});

	it('returns null when response has no id', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({}),
		});

		const result = await postTrelloComment('proj1', 'card1', 'Hello!');

		expect(result).toBeNull();
	});

	it('returns null on fetch error', async () => {
		mockFetch.mockRejectedValueOnce(new Error('Network error'));

		const result = await postTrelloComment('proj1', 'card1', 'Hello!');

		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// postGitHubComment
// ---------------------------------------------------------------------------

describe('postGitHubComment', () => {
	it('posts a comment and returns the comment ID', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ id: 42 }),
		});

		const result = await postGitHubComment('ghp_token', 'owner/repo', 5, 'Working on it...');

		expect(result).toBe(42);
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('https://api.github.com/repos/owner/repo/issues/5/comments');
		expect(options.method).toBe('POST');
		expect(options.headers.Authorization).toBe('Bearer ghp_token');
		expect(options.headers.Accept).toBe('application/vnd.github+json');
		expect(JSON.parse(options.body)).toEqual({ body: 'Working on it...' });
	});

	it('returns null on API failure', async () => {
		mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

		const result = await postGitHubComment('ghp_token', 'owner/repo', 5, 'Hello');

		expect(result).toBeNull();
	});

	it('returns null when response has no id', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({}),
		});

		const result = await postGitHubComment('ghp_token', 'owner/repo', 5, 'Hello');

		expect(result).toBeNull();
	});

	it('returns null on fetch error', async () => {
		mockFetch.mockRejectedValueOnce(new Error('Network error'));

		const result = await postGitHubComment('ghp_token', 'owner/repo', 5, 'Hello');

		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// postJiraComment
// ---------------------------------------------------------------------------

describe('postJiraComment', () => {
	it('posts an ADF comment (v3) and returns the comment ID', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ id: 'jira-comment-1' }),
		});

		const result = await postJiraComment('proj1', 'PROJ-1', 'Hello JIRA!');

		expect(result).toBe('jira-comment-1');
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('https://test.atlassian.net/rest/api/3/issue/PROJ-1/comment');
		expect(options.method).toBe('POST');
		expect(options.headers.Authorization).toMatch(/^Basic /);
		// body should be ADF (has type: 'doc')
		const parsed = JSON.parse(options.body);
		expect(parsed.body).toHaveProperty('type', 'doc');
	});

	it('posts a plain-text comment (v2) when useAdf=false', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ id: 'jira-comment-2' }),
		});

		const result = await postJiraComment('proj1', 'PROJ-2', 'Plain text', false);

		expect(result).toBe('jira-comment-2');
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('https://test.atlassian.net/rest/api/2/issue/PROJ-2/comment');
		const parsed = JSON.parse(options.body);
		expect(parsed.body).toBe('Plain text');
	});

	it('returns null when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await postJiraComment('proj1', 'PROJ-1', 'Hello');

		expect(result).toBeNull();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('returns null on API failure', async () => {
		mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

		const result = await postJiraComment('proj1', 'PROJ-1', 'Hello');

		expect(result).toBeNull();
	});

	it('returns null when response has no id', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({}),
		});

		const result = await postJiraComment('proj1', 'PROJ-1', 'Hello');

		expect(result).toBeNull();
	});

	it('returns null on fetch error', async () => {
		mockFetch.mockRejectedValueOnce(new Error('Network error'));

		const result = await postJiraComment('proj1', 'PROJ-1', 'Hello');

		expect(result).toBeNull();
	});
});

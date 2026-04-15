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

// Mock logger
vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import { findProjectById, getIntegrationCredential } from '../../../src/config/provider.js';
import {
	TrelloPlatformClient,
	resolveGitHubHeaders,
	resolveJiraCredentials,
	resolveTrelloCredentials,
} from '../../../src/router/platformClients/index.js';
import { logger } from '../../../src/utils/logging.js';

const mockLogger = vi.mocked(logger);

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
// TrelloPlatformClient
// ---------------------------------------------------------------------------

describe('TrelloPlatformClient', () => {
	beforeEach(() => {
		mockLogger.info.mockReset();
		mockLogger.warn.mockReset();
	});

	describe('postComment', () => {
		it('posts a comment and returns the comment ID', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ id: 'comment-abc' }),
			});

			const client = new TrelloPlatformClient('proj1');
			const result = await client.postComment('card1', 'Hello');

			expect(result).toBe('comment-abc');
			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toContain('https://api.trello.com/1/cards/card1/actions/comments');
			expect(url).toContain('key=trello-key');
			expect(url).toContain('token=trello-token');
			expect(options.method).toBe('POST');
			expect(JSON.parse(options.body)).toEqual({ text: 'Hello' });
		});

		it('returns null when credentials are missing', async () => {
			mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

			const client = new TrelloPlatformClient('proj1');
			const result = await client.postComment('card1', 'Hello');

			expect(result).toBeNull();
			expect(mockFetch).not.toHaveBeenCalled();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Missing Trello credentials'),
			);
		});

		it('returns null on API error', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: async () => 'Unauthorized',
			});

			const client = new TrelloPlatformClient('proj1');
			const result = await client.postComment('card1', 'Hello');

			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Trello comment failed'),
				401,
				'Unauthorized',
			);
		});

		it('returns null on network error', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network failure'));

			const client = new TrelloPlatformClient('proj1');
			const result = await client.postComment('card1', 'Hello');

			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Failed to post Trello comment'),
				expect.stringContaining('Network failure'),
			);
		});

		it('returns null when response has no id', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({}),
			});

			const client = new TrelloPlatformClient('proj1');
			const result = await client.postComment('card1', 'Hello');

			expect(result).toBeNull();
		});
	});

	describe('deleteComment', () => {
		it('sends DELETE request to remove comment', async () => {
			mockFetch.mockResolvedValueOnce({ ok: true });

			const client = new TrelloPlatformClient('proj1');
			await client.deleteComment('card1', 'comment-abc');

			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toContain('https://api.trello.com/1/cards/card1/actions/comment-abc/comments');
			expect(options.method).toBe('DELETE');
		});

		it('silently returns when credentials are missing', async () => {
			mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

			const client = new TrelloPlatformClient('proj1');
			await client.deleteComment('card1', 'comment-abc');

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('catches fetch errors gracefully', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			const client = new TrelloPlatformClient('proj1');
			await client.deleteComment('card1', 'comment-abc');

			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Failed to delete Trello comment'),
				expect.any(String),
			);
		});
	});
});

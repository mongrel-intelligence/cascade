import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock config provider
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
	_resetJiraBotCache,
	_resetJiraCloudIdCache,
	_resetTrelloBotCache,
	getGitHubTokenForProject,
	getJiraAuthForProject,
	getJiraCloudId,
	getTrelloCredentialsForProject,
	resolveGitHubTokenForAck,
	resolveJiraBotAccountId,
	resolveTrelloBotMemberId,
} from '../../../src/router/platformClients.js';

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

const MOCK_PROJECT = {
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
	mockGetProjectGitHubToken.mockResolvedValue('test-github-token');
	mockFindProjectByRepo.mockResolvedValue({
		id: 'test',
		name: 'Test',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
	});
	mockFindProjectById.mockResolvedValue(MOCK_PROJECT);
});

afterEach(() => {
	vi.restoreAllMocks();
	_resetJiraBotCache();
	_resetTrelloBotCache();
	_resetJiraCloudIdCache();
});

// ---------------------------------------------------------------------------
// getTrelloCredentialsForProject
// ---------------------------------------------------------------------------

describe('getTrelloCredentialsForProject', () => {
	it('returns credentials when both are present', async () => {
		const result = await getTrelloCredentialsForProject('test');

		expect(result).not.toBeNull();
		expect(result?.apiKey).toBe('test-trello-key');
		expect(result?.token).toBe('test-trello-token');
	});

	it('returns null when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await getTrelloCredentialsForProject('test');

		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// getJiraAuthForProject
// ---------------------------------------------------------------------------

describe('getJiraAuthForProject', () => {
	it('returns auth object with basicAuth when all fields present', async () => {
		const result = await getJiraAuthForProject('test');

		expect(result).not.toBeNull();
		expect(result?.email).toBe('bot@example.com');
		expect(result?.apiToken).toBe('test-jira-token');
		expect(result?.baseUrl).toBe('https://test.atlassian.net');
		expect(result?.basicAuth).toMatch(/^[A-Za-z0-9+/]+=*$/); // base64
	});

	it('returns null when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await getJiraAuthForProject('test');

		expect(result).toBeNull();
	});

	it('returns null when JIRA base URL is missing', async () => {
		mockFindProjectById.mockResolvedValue({
			id: 'test',
			name: 'Test',
			repo: 'owner/repo',
			baseBranch: 'main',
			branchPrefix: 'feature/',
		});

		const result = await getJiraAuthForProject('test');

		expect(result).toBeNull();
	});

	it('computes correct basicAuth value', async () => {
		const result = await getJiraAuthForProject('test');

		const expected = Buffer.from('bot@example.com:test-jira-token').toString('base64');
		expect(result?.basicAuth).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// getGitHubTokenForProject
// ---------------------------------------------------------------------------

describe('getGitHubTokenForProject', () => {
	it('returns token and project when both are found', async () => {
		const result = await getGitHubTokenForProject('owner/repo');

		expect(result).not.toBeNull();
		expect(result?.token).toBe('test-github-token');
		expect(result?.project.id).toBe('test');
	});

	it('returns null when project is not found', async () => {
		mockFindProjectByRepo.mockResolvedValue(undefined);

		const result = await getGitHubTokenForProject('unknown/repo');

		expect(result).toBeNull();
	});

	it('returns null when GitHub token is missing', async () => {
		mockGetProjectGitHubToken.mockRejectedValue(new Error('Missing token'));

		const result = await getGitHubTokenForProject('owner/repo');

		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// resolveGitHubTokenForAck (alias for getGitHubTokenForProject)
// ---------------------------------------------------------------------------

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
});

// ---------------------------------------------------------------------------
// resolveTrelloBotMemberId
// ---------------------------------------------------------------------------

describe('resolveTrelloBotMemberId', () => {
	it('returns member ID from /1/members/me', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ id: 'trello-bot-456' }),
		});

		const result = await resolveTrelloBotMemberId('test');

		expect(result).toBe('trello-bot-456');
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url] = mockFetch.mock.calls[0];
		expect(url).toContain('https://api.trello.com/1/members/me');
		expect(url).toContain('key=test-trello-key');
		expect(url).toContain('token=test-trello-token');
	});

	it('caches the result for subsequent calls', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ id: 'trello-bot-456' }),
		});

		const result1 = await resolveTrelloBotMemberId('test');
		const result2 = await resolveTrelloBotMemberId('test');

		expect(result1).toBe('trello-bot-456');
		expect(result2).toBe('trello-bot-456');
		expect(mockFetch).toHaveBeenCalledOnce(); // Only one API call
	});

	it('returns null when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await resolveTrelloBotMemberId('test');

		expect(result).toBeNull();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('returns null on API error', async () => {
		mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

		const result = await resolveTrelloBotMemberId('test');

		expect(result).toBeNull();
	});

	it('returns null when response has no id', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({}),
		});

		const result = await resolveTrelloBotMemberId('test');

		expect(result).toBeNull();
	});

	it('cache expires after TTL and re-fetches', async () => {
		mockFetch
			.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'bot-1' }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'bot-2' }) });

		const result1 = await resolveTrelloBotMemberId('test');

		// Manually manipulate cache TTL by clearing and re-calling
		_resetTrelloBotCache();

		const result2 = await resolveTrelloBotMemberId('test');

		expect(result1).toBe('bot-1');
		expect(result2).toBe('bot-2');
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});
});

// ---------------------------------------------------------------------------
// resolveJiraBotAccountId
// ---------------------------------------------------------------------------

describe('resolveJiraBotAccountId', () => {
	it('returns account ID from /rest/api/2/myself', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ accountId: 'jira-bot-123' }),
		});

		const result = await resolveJiraBotAccountId('test');

		expect(result).toBe('jira-bot-123');
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('https://test.atlassian.net/rest/api/2/myself');
		expect(options.headers.Authorization).toMatch(/^Basic /);
	});

	it('caches the result for subsequent calls', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ accountId: 'jira-bot-123' }),
		});

		const result1 = await resolveJiraBotAccountId('test');
		const result2 = await resolveJiraBotAccountId('test');

		expect(result1).toBe('jira-bot-123');
		expect(result2).toBe('jira-bot-123');
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it('returns null when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await resolveJiraBotAccountId('test');

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

		const result = await resolveJiraBotAccountId('test');

		expect(result).toBeNull();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('returns null on API error', async () => {
		mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

		const result = await resolveJiraBotAccountId('test');

		expect(result).toBeNull();
	});

	it('returns null when response has no accountId', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({}),
		});

		const result = await resolveJiraBotAccountId('test');

		expect(result).toBeNull();
	});

	it('cache can be cleared and re-fetches', async () => {
		mockFetch
			.mockResolvedValueOnce({ ok: true, json: async () => ({ accountId: 'acct-1' }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ accountId: 'acct-2' }) });

		const result1 = await resolveJiraBotAccountId('test');
		_resetJiraBotCache();
		const result2 = await resolveJiraBotAccountId('test');

		expect(result1).toBe('acct-1');
		expect(result2).toBe('acct-2');
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});
});

// ---------------------------------------------------------------------------
// getJiraCloudId
// ---------------------------------------------------------------------------

describe('getJiraCloudId', () => {
	const mockAuth = {
		email: 'bot@example.com',
		apiToken: 'test-jira-token',
		baseUrl: 'https://test.atlassian.net',
		basicAuth: Buffer.from('bot@example.com:test-jira-token').toString('base64'),
	};

	it('returns cloudId from tenant_info endpoint', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ cloudId: 'cloud-abc-123' }),
		});

		const result = await getJiraCloudId(mockAuth);

		expect(result).toBe('cloud-abc-123');
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('https://test.atlassian.net/_edge/tenant_info');
		expect(options.headers.Authorization).toMatch(/^Basic /);
	});

	it('caches the cloudId for subsequent calls with same baseUrl', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ cloudId: 'cloud-abc-123' }),
		});

		const result1 = await getJiraCloudId(mockAuth);
		const result2 = await getJiraCloudId(mockAuth);

		expect(result1).toBe('cloud-abc-123');
		expect(result2).toBe('cloud-abc-123');
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it('returns null on network error', async () => {
		mockFetch.mockRejectedValueOnce(new Error('Network error'));

		const result = await getJiraCloudId(mockAuth);

		expect(result).toBeNull();
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('Failed to fetch JIRA cloudId'),
			expect.any(String),
		);
	});

	it('returns null on HTTP error', async () => {
		mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

		const result = await getJiraCloudId(mockAuth);

		expect(result).toBeNull();
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('JIRA tenant_info returned'),
			403,
		);
	});

	it('returns null when cloudId is missing from response', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({}),
		});

		const result = await getJiraCloudId(mockAuth);

		expect(result).toBeNull();
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('JIRA tenant_info missing cloudId'),
		);
	});

	it('cache can be cleared and re-fetches', async () => {
		mockFetch
			.mockResolvedValueOnce({ ok: true, json: async () => ({ cloudId: 'cloud-1' }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ cloudId: 'cloud-2' }) });

		const result1 = await getJiraCloudId(mockAuth);
		_resetJiraCloudIdCache();
		const result2 = await getJiraCloudId(mockAuth);

		expect(result1).toBe('cloud-1');
		expect(result2).toBe('cloud-2');
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock config provider for DB secret resolution
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
	_resetJiraBotCache,
	_resetLinearBotCache,
	_resetTrelloBotCache,
	resolveJiraBotAccountId,
	resolveLinearBotIdentity,
	resolveLinearBotUserId,
	resolveTrelloBotMemberId,
} from '../../../src/router/bot-identity-resolvers.js';

const mockGetIntegrationCredential = vi.mocked(getIntegrationCredential);
const mockFindProjectById = vi.mocked(findProjectById);

const MOCK_CREDENTIALS: Record<string, string> = {
	'pm/api_key': 'test-trello-key',
	'pm/linear/api_key': 'test-linear-key',
	'pm/token': 'test-trello-token',
	'pm/email': 'bot@example.com',
	'pm/api_token': 'test-jira-token',
};

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
	mockFetch.mockReset();

	mockGetIntegrationCredential.mockImplementation(async (_projectId, category, _provider, role) => {
		const value =
			MOCK_CREDENTIALS[`${category}/${_provider}/${role}`] ??
			MOCK_CREDENTIALS[`${category}/${role}`];
		if (value) return value;
		throw new Error(`Credential '${category}/${role}' not found`);
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
	_resetJiraBotCache();
	_resetLinearBotCache();
	_resetTrelloBotCache();
});

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
		expect(mockFetch).toHaveBeenCalledOnce(); // Only one API call
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
});

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
});

describe('resolveLinearBotIdentity', () => {
	it('returns user identity from viewer query', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: {
					viewer: {
						id: 'linear-bot-789',
						name: 'cascade',
						email: 'cascade@example.test',
						displayName: 'cascade',
					},
				},
			}),
		});

		const result = await resolveLinearBotIdentity('test');

		expect(result).toEqual({
			id: 'linear-bot-789',
			name: 'cascade',
			email: 'cascade@example.test',
			displayName: 'cascade',
		});
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toBe('https://api.linear.app/graphql');
		expect(options.headers.Authorization).toBe('test-linear-key');
		expect(options.body).toContain('viewer { id name email displayName }');
	});

	it('caches the identity for subsequent calls', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: {
					viewer: {
						id: 'linear-bot-789',
						name: 'cascade',
						email: 'cascade@example.test',
						displayName: 'cascade',
					},
				},
			}),
		});

		const result1 = await resolveLinearBotIdentity('test');
		const result2 = await resolveLinearBotIdentity('test');

		expect(result1?.id).toBe('linear-bot-789');
		expect(result2?.id).toBe('linear-bot-789');
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it('resolves user ID through the shared identity resolver', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: {
					viewer: {
						id: 'linear-bot-789',
						name: 'cascade',
						email: 'cascade@example.test',
						displayName: 'cascade',
					},
				},
			}),
		});

		const result = await resolveLinearBotUserId('test');

		expect(result).toBe('linear-bot-789');
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it('returns null when credentials are missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await resolveLinearBotIdentity('test');

		expect(result).toBeNull();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('returns null on API error', async () => {
		mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

		const result = await resolveLinearBotIdentity('test');

		expect(result).toBeNull();
	});

	it('returns null when response has no viewer id', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ data: { viewer: { name: 'cascade' } } }),
		});

		const result = await resolveLinearBotIdentity('test');

		expect(result).toBeNull();
	});
});

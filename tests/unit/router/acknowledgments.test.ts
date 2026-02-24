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

// Mock logger
vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
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
	_resetTrelloBotCache,
	deleteGitHubAck,
	deleteJiraAck,
	deleteTrelloAck,
	postGitHubAck,
	postJiraAck,
	postTrelloAck,
	resolveGitHubTokenForAck,
	resolveGitHubTokenForAckByAgent,
	resolveJiraBotAccountId,
	resolveTrelloBotMemberId,
} from '../../../src/router/acknowledgments.js';
import { logger } from '../../../src/utils/logging.js';

const mockGetIntegrationCredential = vi.mocked(getIntegrationCredential);
const mockGetProjectGitHubToken = vi.mocked(getProjectGitHubToken);
const mockFindProjectByRepo = vi.mocked(findProjectByRepo);
const mockFindProjectById = vi.mocked(findProjectById);
const mockLogger = vi.mocked(logger);

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
	mockLogger.info.mockReset();
	mockLogger.warn.mockReset();
	mockLogger.error.mockReset();

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
	_resetJiraBotCache();
	_resetTrelloBotCache();
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
		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('[PlatformClient] Trello comment failed'),
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

		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Failed to delete Trello comment'),
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
		expect(mockLogger.warn).toHaveBeenCalledWith(
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

		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Failed to delete GitHub comment'),
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
		expect(url).toBe('https://test.atlassian.net/rest/api/3/issue/PROJ-42/comment');
		expect(options.method).toBe('POST');
		expect(options.headers.Authorization).toMatch(/^Basic /);
		const parsed = JSON.parse(options.body);
		expect(parsed.body).toEqual({
			type: 'doc',
			version: 1,
			content: [
				{
					type: 'paragraph',
					content: [{ type: 'text', text: 'Working on it...' }],
				},
			],
		});
	});

	it('converts markdown bold to ADF strong marks', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ id: 'jira-comment-789' }),
		});

		const message =
			'**🗺️ Planning implementation** — Studying the codebase and designing a step-by-step plan...';
		const result = await postJiraAck('test', 'PROJ-42', message);

		expect(result).toBe('jira-comment-789');
		const [, options] = mockFetch.mock.calls[0];
		const parsed = JSON.parse(options.body);
		const paragraph = parsed.body.content[0];
		expect(paragraph.type).toBe('paragraph');
		// Bold text should have a 'strong' mark, not raw asterisks
		const boldNode = paragraph.content.find((n: { marks?: { type: string }[] }) =>
			n.marks?.some((m: { type: string }) => m.type === 'strong'),
		);
		expect(boldNode).toBeDefined();
		expect(boldNode.text).toBe('🗺️ Planning implementation');
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
		expect(mockLogger.warn).toHaveBeenCalledWith(
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

		expect(mockLogger.warn).toHaveBeenCalledWith(
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

describe('resolveGitHubTokenForAckByAgent', () => {
	it('returns reviewer token for review agent type', async () => {
		mockGetIntegrationCredential.mockImplementation(async (_projectId, category, role) => {
			if (category === 'scm' && role === 'reviewer_token') return 'test-reviewer-token';
			const value = MOCK_CREDENTIALS[`${category}/${role}`];
			if (value) return value;
			throw new Error(`Credential '${category}/${role}' not found`);
		});

		const result = await resolveGitHubTokenForAckByAgent('owner/repo', 'review');

		expect(result).not.toBeNull();
		expect(result?.token).toBe('test-reviewer-token');
		expect(result?.project.id).toBe('test');
		expect(mockGetProjectGitHubToken).not.toHaveBeenCalled();
	});

	it('returns implementer token for non-review agent types', async () => {
		const result = await resolveGitHubTokenForAckByAgent('owner/repo', 'implementation');

		expect(result).not.toBeNull();
		expect(result?.token).toBe('test-github-token');
		expect(result?.project.id).toBe('test');
		expect(mockGetProjectGitHubToken).toHaveBeenCalled();
	});

	it('returns null when project is not found', async () => {
		mockFindProjectByRepo.mockResolvedValue(undefined);

		const result = await resolveGitHubTokenForAckByAgent('unknown/repo', 'review');

		expect(result).toBeNull();
	});

	it('returns null when reviewer token is missing', async () => {
		mockGetIntegrationCredential.mockRejectedValue(new Error('not found'));

		const result = await resolveGitHubTokenForAckByAgent('owner/repo', 'review');

		expect(result).toBeNull();
	});
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

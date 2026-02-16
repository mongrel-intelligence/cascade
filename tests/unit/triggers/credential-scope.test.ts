import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all external dependencies
vi.mock('../../../src/config/provider.js', () => ({
	getProjectSecret: vi.fn(),
	getAgentCredential: vi.fn(),
}));

vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((token, fn) => fn()),
}));

vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn((creds, fn) => fn()),
}));

vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn((creds, fn) => fn()),
}));

vi.mock('../../../src/pm/index.js', () => ({
	createPMProvider: vi.fn(() => ({ type: 'mock-pm' })),
	withPMProvider: vi.fn((provider, fn) => fn()),
}));

vi.mock('../../../src/utils/llmEnv.js', () => ({
	injectLlmApiKeys: vi.fn(() => Promise.resolve(vi.fn())),
}));

import { getAgentCredential, getProjectSecret } from '../../../src/config/provider.js';
import { withGitHubToken } from '../../../src/github/client.js';
import { withJiraCredentials } from '../../../src/jira/client.js';
import { createPMProvider, withPMProvider } from '../../../src/pm/index.js';
import { withTrelloCredentials } from '../../../src/trello/client.js';
import { withProjectCredentials } from '../../../src/triggers/shared/credential-scope.js';
import type { ProjectConfig } from '../../../src/types/index.js';
import { injectLlmApiKeys } from '../../../src/utils/llmEnv.js';

describe('withProjectCredentials', () => {
	const baseTrelloProject: ProjectConfig = {
		id: 'test-trello',
		name: 'Test Trello',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		trello: {
			boardId: 'board123',
			lists: {},
			labels: {},
		},
	};

	const baseJiraProject: ProjectConfig = {
		id: 'test-jira',
		name: 'Test JIRA',
		repo: 'owner/repo',
		baseBranch: 'main',
		branchPrefix: 'feature/',
		jira: {
			projectKey: 'TEST',
			baseUrl: 'https://test.atlassian.net',
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getProjectSecret).mockImplementation(async (projectId, key) => {
			const secrets: Record<string, string> = {
				TRELLO_API_KEY: 'trello-key',
				TRELLO_TOKEN: 'trello-token',
				JIRA_EMAIL: 'test@example.com',
				JIRA_API_TOKEN: 'jira-token',
				JIRA_BASE_URL: 'https://jira.example.com',
				GITHUB_TOKEN: 'github-token',
			};
			return secrets[key] || '';
		});
		vi.mocked(getAgentCredential).mockResolvedValue(null);
	});

	it('uses Trello credentials for Trello projects', async () => {
		const mockFn = vi.fn(async () => 'result');

		const result = await withProjectCredentials(baseTrelloProject, 'implementation', mockFn);

		expect(result).toBe('result');
		expect(injectLlmApiKeys).toHaveBeenCalledWith('test-trello');
		expect(withTrelloCredentials).toHaveBeenCalledWith(
			{ apiKey: 'trello-key', token: 'trello-token' },
			expect.any(Function),
		);
		expect(createPMProvider).toHaveBeenCalledWith(baseTrelloProject);
		expect(withPMProvider).toHaveBeenCalled();
		expect(withGitHubToken).toHaveBeenCalledWith('github-token', expect.any(Function));
		expect(mockFn).toHaveBeenCalledOnce();
	});

	it('uses JIRA credentials for JIRA projects', async () => {
		const mockFn = vi.fn(async () => 'result');

		const result = await withProjectCredentials(baseJiraProject, 'implementation', mockFn);

		expect(result).toBe('result');
		expect(injectLlmApiKeys).toHaveBeenCalledWith('test-jira');
		expect(withJiraCredentials).toHaveBeenCalledWith(
			{
				email: 'test@example.com',
				apiToken: 'jira-token',
				baseUrl: 'https://test.atlassian.net',
			},
			expect.any(Function),
		);
		expect(createPMProvider).toHaveBeenCalledWith(baseJiraProject);
		expect(withPMProvider).toHaveBeenCalled();
		expect(withGitHubToken).toHaveBeenCalledWith('github-token', expect.any(Function));
		expect(mockFn).toHaveBeenCalledOnce();
	});

	it('uses agent-scoped GitHub token when available', async () => {
		vi.mocked(getAgentCredential).mockResolvedValue('agent-github-token');
		const mockFn = vi.fn(async () => 'result');

		await withProjectCredentials(baseTrelloProject, 'review', mockFn);

		expect(getAgentCredential).toHaveBeenCalledWith('test-trello', 'review', 'GITHUB_TOKEN');
		expect(withGitHubToken).toHaveBeenCalledWith('agent-github-token', expect.any(Function));
	});

	it('falls back to project GitHub token when no agent override', async () => {
		vi.mocked(getAgentCredential).mockResolvedValue(null);
		const mockFn = vi.fn(async () => 'result');

		await withProjectCredentials(baseTrelloProject, 'implementation', mockFn);

		expect(withGitHubToken).toHaveBeenCalledWith('github-token', expect.any(Function));
	});

	it('restores LLM environment after execution', async () => {
		const restoreFn = vi.fn();
		vi.mocked(injectLlmApiKeys).mockResolvedValue(restoreFn);
		const mockFn = vi.fn(async () => 'result');

		await withProjectCredentials(baseTrelloProject, 'implementation', mockFn);

		expect(restoreFn).toHaveBeenCalledOnce();
	});

	it('restores LLM environment even on error', async () => {
		const restoreFn = vi.fn();
		vi.mocked(injectLlmApiKeys).mockResolvedValue(restoreFn);
		const mockFn = vi.fn(async () => {
			throw new Error('Test error');
		});

		await expect(
			withProjectCredentials(baseTrelloProject, 'implementation', mockFn),
		).rejects.toThrow('Test error');

		expect(restoreFn).toHaveBeenCalledOnce();
	});
});

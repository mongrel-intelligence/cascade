import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all dependencies
vi.mock('../../../src/config/provider.js', () => ({
	getProjectSecret: vi.fn(),
	getAgentCredential: vi.fn(),
}));

vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((token, cb) => cb()),
}));

vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn((creds, cb) => cb()),
}));

vi.mock('../../../src/pm/index.js', () => ({
	createPMProvider: vi.fn(() => ({ type: 'mock' })),
	withPMProvider: vi.fn((provider, cb) => cb()),
}));

vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn((creds, cb) => cb()),
}));

vi.mock('../../../src/utils/llmEnv.js', () => ({
	injectLlmApiKeys: vi.fn(() => Promise.resolve(() => {})),
}));

import { getAgentCredential, getProjectSecret } from '../../../src/config/provider.js';
import { withGitHubToken } from '../../../src/github/client.js';
import { withJiraCredentials } from '../../../src/jira/client.js';
import { createPMProvider, withPMProvider } from '../../../src/pm/index.js';
import { withTrelloCredentials } from '../../../src/trello/client.js';
import { withProjectCredentials } from '../../../src/triggers/shared/credential-scope.js';
import type { ProjectConfig } from '../../../src/types/index.js';
import { injectLlmApiKeys } from '../../../src/utils/llmEnv.js';

const baseTrelloProject: ProjectConfig = {
	id: 'test-project',
	name: 'Test Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	trello: {
		boardId: 'board123',
		lists: {},
		labels: {},
	},
};

const jiraProject: ProjectConfig = {
	...baseTrelloProject,
	pm: { type: 'jira' },
	jira: {
		baseUrl: 'https://test.atlassian.net',
		projectKey: 'TEST',
		customFields: {},
	},
};

describe('withProjectCredentials', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('calls Trello credential scoping for Trello project', async () => {
		vi.mocked(getProjectSecret).mockImplementation(async (projectId, key) => {
			if (key === 'TRELLO_API_KEY') return 'trello-key';
			if (key === 'TRELLO_TOKEN') return 'trello-token';
			if (key === 'GITHUB_TOKEN') return 'gh-token';
			return '';
		});
		vi.mocked(getAgentCredential).mockResolvedValue(null);

		const callback = vi.fn().mockResolvedValue('result');
		const result = await withProjectCredentials(baseTrelloProject, 'implementation', callback);

		expect(result).toBe('result');
		expect(withTrelloCredentials).toHaveBeenCalledWith(
			{ apiKey: 'trello-key', token: 'trello-token' },
			expect.any(Function),
		);
		expect(withPMProvider).toHaveBeenCalled();
		expect(withGitHubToken).toHaveBeenCalledWith('gh-token', expect.any(Function));
		expect(callback).toHaveBeenCalled();
	});

	it('calls JIRA credential scoping for JIRA project', async () => {
		vi.mocked(getProjectSecret).mockImplementation(async (projectId, key) => {
			if (key === 'JIRA_EMAIL') return 'test@example.com';
			if (key === 'JIRA_API_TOKEN') return 'jira-token';
			if (key === 'JIRA_BASE_URL') return 'https://jira.example.com';
			if (key === 'GITHUB_TOKEN') return 'gh-token';
			return '';
		});
		vi.mocked(getAgentCredential).mockResolvedValue(null);

		const callback = vi.fn().mockResolvedValue('result');
		const result = await withProjectCredentials(jiraProject, 'review', callback);

		expect(result).toBe('result');
		expect(withJiraCredentials).toHaveBeenCalledWith(
			{
				email: 'test@example.com',
				apiToken: 'jira-token',
				baseUrl: 'https://test.atlassian.net',
			},
			expect.any(Function),
		);
		expect(withPMProvider).toHaveBeenCalled();
		expect(withGitHubToken).toHaveBeenCalledWith('gh-token', expect.any(Function));
		expect(callback).toHaveBeenCalled();
	});

	it('uses agent-specific GitHub token override', async () => {
		vi.mocked(getProjectSecret).mockImplementation(async (projectId, key) => {
			if (key === 'TRELLO_API_KEY') return 'trello-key';
			if (key === 'TRELLO_TOKEN') return 'trello-token';
			if (key === 'GITHUB_TOKEN') return 'org-gh-token';
			return '';
		});
		vi.mocked(getAgentCredential).mockResolvedValue('agent-gh-token');

		const callback = vi.fn().mockResolvedValue('result');
		await withProjectCredentials(baseTrelloProject, 'review', callback);

		expect(getAgentCredential).toHaveBeenCalledWith('test-project', 'review', 'GITHUB_TOKEN');
		expect(withGitHubToken).toHaveBeenCalledWith('agent-gh-token', expect.any(Function));
	});

	it('falls back to org GitHub token when no agent override', async () => {
		vi.mocked(getProjectSecret).mockImplementation(async (projectId, key) => {
			if (key === 'TRELLO_API_KEY') return 'trello-key';
			if (key === 'TRELLO_TOKEN') return 'trello-token';
			if (key === 'GITHUB_TOKEN') return 'org-gh-token';
			return '';
		});
		vi.mocked(getAgentCredential).mockResolvedValue(null);

		const callback = vi.fn().mockResolvedValue('result');
		await withProjectCredentials(baseTrelloProject, 'implementation', callback);

		expect(withGitHubToken).toHaveBeenCalledWith('org-gh-token', expect.any(Function));
	});

	it('injects and restores LLM API keys', async () => {
		const restoreLlmEnv = vi.fn();
		vi.mocked(injectLlmApiKeys).mockResolvedValue(restoreLlmEnv);
		vi.mocked(getProjectSecret).mockResolvedValue('dummy');
		vi.mocked(getAgentCredential).mockResolvedValue(null);

		const callback = vi.fn().mockResolvedValue('result');
		await withProjectCredentials(baseTrelloProject, 'debug', callback);

		expect(injectLlmApiKeys).toHaveBeenCalledWith('test-project');
		expect(restoreLlmEnv).toHaveBeenCalled();
	});

	it('restores LLM environment even on callback error', async () => {
		const restoreLlmEnv = vi.fn();
		vi.mocked(injectLlmApiKeys).mockResolvedValue(restoreLlmEnv);
		vi.mocked(getProjectSecret).mockResolvedValue('dummy');
		vi.mocked(getAgentCredential).mockResolvedValue(null);

		const callback = vi.fn().mockRejectedValue(new Error('callback error'));

		await expect(
			withProjectCredentials(baseTrelloProject, 'implementation', callback),
		).rejects.toThrow('callback error');

		expect(restoreLlmEnv).toHaveBeenCalled();
	});

	it('does not query agent credential when agentType is undefined', async () => {
		vi.mocked(getProjectSecret).mockResolvedValue('dummy');

		const callback = vi.fn().mockResolvedValue('result');
		await withProjectCredentials(baseTrelloProject, undefined, callback);

		expect(getAgentCredential).not.toHaveBeenCalled();
		expect(withGitHubToken).toHaveBeenCalledWith('dummy', expect.any(Function));
	});
});

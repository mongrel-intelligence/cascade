import { beforeEach, describe, expect, it, vi } from 'vitest';

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
	createPMProvider: vi.fn(() => ({})),
	withPMProvider: vi.fn((provider, fn) => fn()),
}));

vi.mock('../../../src/utils/llmEnv.js', () => ({
	injectLlmApiKeys: vi.fn(() => Promise.resolve(() => {})),
}));

import { getAgentCredential, getProjectSecret } from '../../../src/config/provider.js';
import { withGitHubToken } from '../../../src/github/client.js';
import { withJiraCredentials } from '../../../src/jira/client.js';
import { withPMProvider } from '../../../src/pm/index.js';
import { withTrelloCredentials } from '../../../src/trello/client.js';
import { withProjectCredentials } from '../../../src/triggers/shared/credential-scope.js';
import type { ProjectConfig } from '../../../src/types/index.js';
import { injectLlmApiKeys } from '../../../src/utils/llmEnv.js';

const trelloProject: ProjectConfig = {
	id: 'trello-project',
	name: 'Trello Project',
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
	id: 'jira-project',
	name: 'JIRA Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	jira: {
		projectKey: 'PROJ',
		baseUrl: 'https://company.atlassian.net',
		lists: {},
		labels: {},
	},
};

const githubOnlyProject: ProjectConfig = {
	id: 'github-project',
	name: 'GitHub Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
};

describe('withProjectCredentials', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getProjectSecret).mockImplementation((projectId, key) => {
			const secrets: Record<string, Record<string, string>> = {
				'trello-project': {
					TRELLO_API_KEY: 'trello-key',
					TRELLO_TOKEN: 'trello-token',
					GITHUB_TOKEN: 'github-token',
				},
				'jira-project': {
					JIRA_EMAIL: 'user@example.com',
					JIRA_API_TOKEN: 'jira-token',
					JIRA_BASE_URL: 'https://company.atlassian.net',
					GITHUB_TOKEN: 'github-token',
				},
				'github-project': {
					GITHUB_TOKEN: 'github-token',
					TRELLO_API_KEY: '',
					TRELLO_TOKEN: '',
				},
			};
			return Promise.resolve(secrets[projectId]?.[key] ?? '');
		});
		vi.mocked(getAgentCredential).mockResolvedValue(null);
	});

	it('uses Trello credentials for Trello project', async () => {
		const fn = vi.fn().mockResolvedValue('result');

		const result = await withProjectCredentials(trelloProject, 'implementation', fn);

		expect(result).toBe('result');
		expect(injectLlmApiKeys).toHaveBeenCalledWith('trello-project');
		expect(withTrelloCredentials).toHaveBeenCalledWith(
			{ apiKey: 'trello-key', token: 'trello-token' },
			expect.any(Function),
		);
		expect(withPMProvider).toHaveBeenCalled();
		expect(withGitHubToken).toHaveBeenCalledWith('github-token', expect.any(Function));
		expect(fn).toHaveBeenCalled();
	});

	it('uses JIRA credentials for JIRA project', async () => {
		const fn = vi.fn().mockResolvedValue('result');

		const result = await withProjectCredentials(jiraProject, 'implementation', fn);

		expect(result).toBe('result');
		expect(injectLlmApiKeys).toHaveBeenCalledWith('jira-project');
		expect(withJiraCredentials).toHaveBeenCalledWith(
			{
				email: 'user@example.com',
				apiToken: 'jira-token',
				baseUrl: 'https://company.atlassian.net',
			},
			expect.any(Function),
		);
		expect(withPMProvider).toHaveBeenCalled();
		expect(withGitHubToken).toHaveBeenCalledWith('github-token', expect.any(Function));
		expect(fn).toHaveBeenCalled();
	});

	it('uses GitHub-only credentials for GitHub project', async () => {
		const fn = vi.fn().mockResolvedValue('result');

		const result = await withProjectCredentials(githubOnlyProject, 'review', fn);

		expect(result).toBe('result');
		expect(injectLlmApiKeys).toHaveBeenCalledWith('github-project');
		expect(withTrelloCredentials).toHaveBeenCalledWith(
			{ apiKey: '', token: '' },
			expect.any(Function),
		);
		expect(withPMProvider).toHaveBeenCalled();
		expect(withGitHubToken).toHaveBeenCalledWith('github-token', expect.any(Function));
		expect(fn).toHaveBeenCalled();
	});

	it('uses agent-specific GitHub token override', async () => {
		vi.mocked(getAgentCredential).mockResolvedValue('agent-github-token');
		const fn = vi.fn().mockResolvedValue('result');

		await withProjectCredentials(trelloProject, 'review', fn);

		expect(getAgentCredential).toHaveBeenCalledWith('trello-project', 'review', 'GITHUB_TOKEN');
		expect(withGitHubToken).toHaveBeenCalledWith('agent-github-token', expect.any(Function));
	});

	it('falls back to project GitHub token when no agent override', async () => {
		vi.mocked(getAgentCredential).mockResolvedValue(null);
		const fn = vi.fn().mockResolvedValue('result');

		await withProjectCredentials(trelloProject, 'implementation', fn);

		expect(withGitHubToken).toHaveBeenCalledWith('github-token', expect.any(Function));
	});

	it('restores LLM environment after execution', async () => {
		const restoreFn = vi.fn();
		vi.mocked(injectLlmApiKeys).mockResolvedValue(restoreFn);
		const fn = vi.fn().mockResolvedValue('result');

		await withProjectCredentials(trelloProject, 'implementation', fn);

		expect(restoreFn).toHaveBeenCalled();
	});

	it('restores LLM environment even if function throws', async () => {
		const restoreFn = vi.fn();
		vi.mocked(injectLlmApiKeys).mockResolvedValue(restoreFn);
		const fn = vi.fn().mockRejectedValue(new Error('Test error'));

		await expect(withProjectCredentials(trelloProject, 'implementation', fn)).rejects.toThrow(
			'Test error',
		);

		expect(restoreFn).toHaveBeenCalled();
	});
});

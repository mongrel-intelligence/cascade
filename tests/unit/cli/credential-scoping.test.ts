import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token: string, fn: () => Promise<void>) => fn()),
}));

vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn(
		(_creds: { apiKey: string; token: string }, fn: () => Promise<void>) => fn(),
	),
}));

// Mocks required for PM integration registration (integrations/bootstrap.js side-effect)
vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: vi.fn().mockResolvedValue('mock-cred'),
	getIntegrationCredentialOrNull: vi.fn().mockResolvedValue(null),
	loadProjectConfigByBoardId: vi.fn().mockResolvedValue(null),
	loadProjectConfigByJiraProjectKey: vi.fn().mockResolvedValue(null),
	findProjectById: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	getIntegrationProvider: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn((_creds: unknown, fn: () => unknown) => fn()),
	jiraClient: {},
}));

vi.mock('../../../src/linear/client.js', () => ({
	withLinearCredentials: vi.fn((_creds: { apiKey: string }, fn: () => unknown) => fn()),
	linearClient: {},
}));

vi.mock('../../../src/github-projects/client.js', () => ({
	withGitHubProjectsCredentials: vi.fn((_creds: { token: string }, fn: () => unknown) => fn()),
}));

vi.mock('../../../src/sentry/integration.js', () => ({
	getSentryIntegrationConfig: vi.fn().mockResolvedValue(null),
	hasAlertingIntegration: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../src/router/acknowledgments.js', () => ({
	postTrelloAck: vi.fn().mockResolvedValue(null),
	deleteTrelloAck: vi.fn().mockResolvedValue(undefined),
	resolveTrelloBotMemberId: vi.fn().mockResolvedValue(null),
	postJiraAck: vi.fn().mockResolvedValue(null),
	deleteJiraAck: vi.fn().mockResolvedValue(undefined),
	resolveJiraBotAccountId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn(),
}));

// Register PM integrations in the registry via the canonical bootstrap path
import '../../../src/integrations/pm/index.js';
import '../../../src/github/register.js';
import '../../../src/sentry/register.js';

import { CredentialScopedCommand, resolveJiraBaseUrl } from '../../../src/cli/base.js';
import { withGitHubToken } from '../../../src/github/client.js';
import { withGitHubProjectsCredentials } from '../../../src/github-projects/client.js';
import { withJiraCredentials } from '../../../src/jira/client.js';
import { withLinearCredentials } from '../../../src/linear/client.js';
import { getPMProvider } from '../../../src/pm/context.js';
import { withTrelloCredentials } from '../../../src/trello/client.js';

class TestCommand extends CredentialScopedCommand {
	static override id = 'test';
	static override description = 'Test command';
	executeCalled = false;

	async execute(): Promise<void> {
		this.executeCalled = true;
	}
}

class InspectPMProviderCommand extends CredentialScopedCommand {
	static override id = 'inspect-pm-provider';
	static override description = 'Inspect PM provider';
	providerConfig: unknown;

	async execute(): Promise<void> {
		this.providerConfig = (getPMProvider() as unknown as { config?: unknown }).config;
	}
}

describe('CredentialScopedCommand', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
		delete process.env.GITHUB_TOKEN;
		delete process.env.GITHUB_PROJECTS_TOKEN;
		delete process.env.TRELLO_API_KEY;
		delete process.env.TRELLO_TOKEN;
		delete process.env.LINEAR_API_KEY;
		delete process.env.CASCADE_PM_TYPE;
		delete process.env.CASCADE_LINEAR_TEAM_ID;
		delete process.env.CASCADE_LINEAR_PROJECT_ID;
		delete process.env.CASCADE_LINEAR_STATUSES;
		delete process.env.CASCADE_TRELLO_BOARD_ID;
		delete process.env.CASCADE_TRELLO_LISTS;
		delete process.env.CASCADE_TRELLO_LABELS;
		// Clear JIRA vars so resolvePmType() falls back to 'trello' when not
		// explicitly testing JIRA behaviour (env may be set on CI/dev machines).
		delete process.env.JIRA_EMAIL;
		delete process.env.JIRA_API_TOKEN;
		delete process.env.JIRA_BASE_URL;
		delete process.env.CASCADE_JIRA_BASE_URL;
		delete process.env.CASCADE_JIRA_PROJECT_KEY;
		delete process.env.CASCADE_JIRA_STATUSES;
		delete process.env.CASCADE_JIRA_AUTH_TYPE;
		delete process.env.CASCADE_GITHUB_PROJECTS_PROJECT_ID;
		delete process.env.CASCADE_GITHUB_PROJECTS_OWNER;
		delete process.env.CASCADE_GITHUB_PROJECTS_OWNER_TYPE;
		delete process.env.CASCADE_GITHUB_PROJECTS_STATUSES;
		delete process.env.CASCADE_GITHUB_PROJECTS_LABELS;
		vi.mocked(withJiraCredentials).mockClear();
		vi.mocked(withLinearCredentials).mockClear();
		vi.mocked(withGitHubProjectsCredentials).mockClear();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('calls execute() without scoping when no env vars are set', async () => {
		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withGitHubToken).not.toHaveBeenCalled();
		expect(withTrelloCredentials).not.toHaveBeenCalled();
	});

	it('wraps execute() with withGitHubToken when GITHUB_TOKEN is set', async () => {
		process.env.GITHUB_TOKEN = 'ghp_test123';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withGitHubToken).toHaveBeenCalledWith('ghp_test123', expect.any(Function));
		expect(withTrelloCredentials).not.toHaveBeenCalled();
	});

	it('wraps execute() with withTrelloCredentials when TRELLO_API_KEY and TRELLO_TOKEN are set', async () => {
		process.env.TRELLO_API_KEY = 'trello-key';
		process.env.TRELLO_TOKEN = 'trello-token';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withTrelloCredentials).toHaveBeenCalledWith(
			{ apiKey: 'trello-key', token: 'trello-token' },
			expect.any(Function),
		);
		expect(withGitHubToken).not.toHaveBeenCalled();
	});

	it('does not wrap with Trello credentials when only TRELLO_API_KEY is set', async () => {
		process.env.TRELLO_API_KEY = 'trello-key';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withTrelloCredentials).not.toHaveBeenCalled();
	});

	it('wraps with both GitHub and Trello scoping when all env vars are set', async () => {
		process.env.GITHUB_TOKEN = 'ghp_test123';
		process.env.TRELLO_API_KEY = 'trello-key';
		process.env.TRELLO_TOKEN = 'trello-token';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withGitHubToken).toHaveBeenCalledWith('ghp_test123', expect.any(Function));
		expect(withTrelloCredentials).toHaveBeenCalledWith(
			{ apiKey: 'trello-key', token: 'trello-token' },
			expect.any(Function),
		);
	});

	it('wraps execute() with withJiraCredentials when only CASCADE_JIRA_BASE_URL is set', async () => {
		process.env.JIRA_EMAIL = 'bot@example.com';
		process.env.JIRA_API_TOKEN = 'jira-token';
		process.env.CASCADE_JIRA_BASE_URL = 'https://cascade.atlassian.net';
		process.env.CASCADE_JIRA_PROJECT_KEY = 'CASCADE';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		// authType defaults to 'basic' when CASCADE_JIRA_AUTH_TYPE is unset (MNG-1741).
		expect(withJiraCredentials).toHaveBeenCalledWith(
			{
				email: 'bot@example.com',
				apiToken: 'jira-token',
				baseUrl: 'https://cascade.atlassian.net',
				authType: 'basic',
			},
			expect.any(Function),
		);
	});

	it('threads authType into withJiraCredentials from CASCADE_JIRA_AUTH_TYPE (MNG-1741)', async () => {
		process.env.JIRA_EMAIL = 'bot@example.com';
		process.env.JIRA_API_TOKEN = 'jira-token';
		process.env.CASCADE_JIRA_BASE_URL = 'https://cascade.atlassian.net';
		process.env.CASCADE_JIRA_PROJECT_KEY = 'CASCADE';
		process.env.CASCADE_JIRA_AUTH_TYPE = 'scoped';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(withJiraCredentials).toHaveBeenCalledWith(
			{
				email: 'bot@example.com',
				apiToken: 'jira-token',
				baseUrl: 'https://cascade.atlassian.net',
				authType: 'scoped',
			},
			expect.any(Function),
		);
	});

	it("normalizes an unknown CASCADE_JIRA_AUTH_TYPE to 'basic' in the credential scope (MNG-1741)", async () => {
		process.env.JIRA_EMAIL = 'bot@example.com';
		process.env.JIRA_API_TOKEN = 'jira-token';
		process.env.CASCADE_JIRA_BASE_URL = 'https://cascade.atlassian.net';
		process.env.CASCADE_JIRA_PROJECT_KEY = 'CASCADE';
		process.env.CASCADE_JIRA_AUTH_TYPE = 'bearer'; // not in the basic|scoped domain

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(withJiraCredentials).toHaveBeenCalledWith(
			expect.objectContaining({ authType: 'basic' }),
			expect.any(Function),
		);
	});

	it('prefers JIRA_BASE_URL over CASCADE_JIRA_BASE_URL when both are set', async () => {
		process.env.JIRA_BASE_URL = 'https://legacy.atlassian.net';
		process.env.CASCADE_JIRA_BASE_URL = 'https://injected.atlassian.net';

		expect(resolveJiraBaseUrl()).toBe('https://legacy.atlassian.net');
	});

	it('falls back to CASCADE_JIRA_BASE_URL when JIRA_BASE_URL is not set', async () => {
		process.env.CASCADE_JIRA_BASE_URL = 'https://injected.atlassian.net';

		expect(resolveJiraBaseUrl()).toBe('https://injected.atlassian.net');
	});

	// Linear scope — mirrors the GitHub/Trello/JIRA pattern. Without these the CLI
	// throws `Linear integration requires teamId in config` whenever a Linear-backed
	// agent run invokes any `cascade-tools pm <cmd>`.

	it('wraps execute() with withLinearCredentials when LINEAR_API_KEY is set', async () => {
		process.env.LINEAR_API_KEY = 'lin_test_key';
		process.env.CASCADE_PM_TYPE = 'linear';
		process.env.CASCADE_LINEAR_TEAM_ID = 'team-uuid';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withLinearCredentials).toHaveBeenCalledWith(
			{ apiKey: 'lin_test_key' },
			expect.any(Function),
		);
	});

	it('synthesises a populated linear config when CASCADE_LINEAR_TEAM_ID is set so createPMProvider does not throw', async () => {
		process.env.CASCADE_PM_TYPE = 'linear';
		process.env.CASCADE_LINEAR_TEAM_ID = 'team-uuid';
		process.env.CASCADE_LINEAR_STATUSES = JSON.stringify({ backlog: 'state-bl' });

		const cmd = new TestCommand([], {} as never);
		await expect(cmd.run()).resolves.not.toThrow();
	});

	it('infers pmType=linear when LINEAR_API_KEY is set and CASCADE_PM_TYPE is not', async () => {
		process.env.LINEAR_API_KEY = 'lin_test_key';
		process.env.CASCADE_LINEAR_TEAM_ID = 'team-uuid';
		// No CASCADE_PM_TYPE, no JIRA env vars — should still construct a Linear
		// provider (and not fall back to a misconfigured Trello synthesis).

		const cmd = new TestCommand([], {} as never);
		await expect(cmd.run()).resolves.not.toThrow();
		expect(withLinearCredentials).toHaveBeenCalled();
	});

	it('synthesises Trello board/list/label config from env vars for scoped PM commands', async () => {
		process.env.CASCADE_PM_TYPE = 'trello';
		process.env.CASCADE_TRELLO_BOARD_ID = 'board-123';
		process.env.CASCADE_TRELLO_LISTS = JSON.stringify({
			todo: 'list-todo',
			friction: 'list-friction',
		});
		process.env.CASCADE_TRELLO_LABELS = JSON.stringify({ auto: 'label-auto' });

		const cmd = new InspectPMProviderCommand([], {} as never);
		await cmd.run();

		expect(cmd.providerConfig).toEqual({
			boardId: 'board-123',
			lists: { todo: 'list-todo', friction: 'list-friction' },
			labels: { auto: 'label-auto' },
		});
	});

	it('synthesises JIRA config from env vars including authType from CASCADE_JIRA_AUTH_TYPE (MNG-1741)', async () => {
		process.env.CASCADE_PM_TYPE = 'jira';
		process.env.CASCADE_JIRA_PROJECT_KEY = 'CASCADE';
		process.env.CASCADE_JIRA_BASE_URL = 'https://acme.atlassian.net';
		process.env.CASCADE_JIRA_AUTH_TYPE = 'scoped';
		process.env.CASCADE_JIRA_STATUSES = JSON.stringify({ todo: 'To Do' });

		const cmd = new InspectPMProviderCommand([], {} as never);
		await cmd.run();

		expect(cmd.providerConfig).toEqual({
			projectKey: 'CASCADE',
			baseUrl: 'https://acme.atlassian.net',
			authType: 'scoped',
			statuses: { todo: 'To Do' },
		});
	});

	it("synthesises JIRA config with authType 'basic' when CASCADE_JIRA_AUTH_TYPE is unset (MNG-1741)", async () => {
		process.env.CASCADE_PM_TYPE = 'jira';
		process.env.CASCADE_JIRA_PROJECT_KEY = 'CASCADE';
		process.env.CASCADE_JIRA_BASE_URL = 'https://acme.atlassian.net';
		// CASCADE_JIRA_AUTH_TYPE intentionally unset → normalizes to 'basic'.

		const cmd = new InspectPMProviderCommand([], {} as never);
		await cmd.run();

		expect(cmd.providerConfig).toMatchObject({
			projectKey: 'CASCADE',
			baseUrl: 'https://acme.atlassian.net',
			authType: 'basic',
		});
	});

	// GitHub Projects scope — mirrors the Trello/JIRA/Linear pattern. GitHub
	// Projects uses its own credential (GITHUB_PROJECTS_TOKEN) and only establishes
	// its dedicated AsyncLocalStorage scope when CASCADE_PM_TYPE=github-projects.
	// It intentionally does NOT read GITHUB_TOKEN (the SCM persona token), so the
	// configured PM PAT survives the worker's persona-token override and the two
	// scopes stay decoupled.

	it('wraps execute() with withGitHubProjectsCredentials from GITHUB_PROJECTS_TOKEN (decoupled from the SCM GITHUB_TOKEN)', async () => {
		// Both are set in a real worker: GITHUB_TOKEN carries the SCM persona token,
		// GITHUB_PROJECTS_TOKEN carries the configured PM PAT. They must NOT collide.
		process.env.GITHUB_TOKEN = 'ghp_persona';
		process.env.GITHUB_PROJECTS_TOKEN = 'ghp_pmpat';
		process.env.CASCADE_PM_TYPE = 'github-projects';
		process.env.CASCADE_GITHUB_PROJECTS_PROJECT_ID = 'PVT_test';
		process.env.CASCADE_GITHUB_PROJECTS_OWNER = 'acme';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		// PM scope uses the dedicated PM PAT, not the SCM persona token.
		expect(withGitHubProjectsCredentials).toHaveBeenCalledWith(
			{ token: 'ghp_pmpat' },
			expect.any(Function),
		);
		// SCM scope still uses the persona token — independently.
		expect(withGitHubToken).toHaveBeenCalledWith('ghp_persona', expect.any(Function));
	});

	it('does not wrap with withGitHubProjectsCredentials when GITHUB_PROJECTS_TOKEN is set but CASCADE_PM_TYPE is not github-projects', async () => {
		process.env.GITHUB_PROJECTS_TOKEN = 'ghp_pmpat';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withGitHubProjectsCredentials).not.toHaveBeenCalled();
	});

	it('does not wrap with withGitHubProjectsCredentials when only the SCM GITHUB_TOKEN is set (no GITHUB_PROJECTS_TOKEN)', async () => {
		// The SCM persona token must never be used to scope PM calls.
		process.env.GITHUB_TOKEN = 'ghp_persona';
		process.env.CASCADE_PM_TYPE = 'github-projects';
		process.env.CASCADE_GITHUB_PROJECTS_PROJECT_ID = 'PVT_test';
		process.env.CASCADE_GITHUB_PROJECTS_OWNER = 'acme';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withGitHubProjectsCredentials).not.toHaveBeenCalled();
	});

	it('does not wrap with withGitHubProjectsCredentials when CASCADE_PM_TYPE=github-projects but GITHUB_PROJECTS_TOKEN is unset', async () => {
		process.env.CASCADE_PM_TYPE = 'github-projects';
		process.env.CASCADE_GITHUB_PROJECTS_PROJECT_ID = 'PVT_test';
		process.env.CASCADE_GITHUB_PROJECTS_OWNER = 'acme';

		const cmd = new TestCommand([], {} as never);
		await cmd.run();

		expect(cmd.executeCalled).toBe(true);
		expect(withGitHubProjectsCredentials).not.toHaveBeenCalled();
	});

	it('synthesises GitHub Projects config from env vars for scoped PM commands', async () => {
		process.env.CASCADE_PM_TYPE = 'github-projects';
		process.env.CASCADE_GITHUB_PROJECTS_PROJECT_ID = 'PVT_kwABC';
		process.env.CASCADE_GITHUB_PROJECTS_OWNER = 'acme-org';
		process.env.CASCADE_GITHUB_PROJECTS_OWNER_TYPE = 'organization';
		process.env.CASCADE_GITHUB_PROJECTS_STATUSES = JSON.stringify({ todo: 'Todo' });
		process.env.CASCADE_GITHUB_PROJECTS_LABELS = JSON.stringify({ auto: 'label-auto' });

		const cmd = new InspectPMProviderCommand([], {} as never);
		await cmd.run();

		expect(cmd.providerConfig).toEqual({
			projectId: 'PVT_kwABC',
			owner: 'acme-org',
			ownerType: 'organization',
			statuses: { todo: 'Todo' },
			labels: { auto: 'label-auto' },
		});
	});

	it('defaults ownerType to "user" and omits labels when not set in env', async () => {
		process.env.CASCADE_PM_TYPE = 'github-projects';
		process.env.CASCADE_GITHUB_PROJECTS_PROJECT_ID = 'PVT_kwABC';
		process.env.CASCADE_GITHUB_PROJECTS_OWNER = 'someuser';
		// CASCADE_GITHUB_PROJECTS_OWNER_TYPE and CASCADE_GITHUB_PROJECTS_LABELS intentionally unset.

		const cmd = new InspectPMProviderCommand([], {} as never);
		await cmd.run();

		expect(cmd.providerConfig).toEqual({
			projectId: 'PVT_kwABC',
			owner: 'someuser',
			ownerType: 'user',
			statuses: {},
		});
	});
});

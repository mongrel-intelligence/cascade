import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadConfig = vi.fn();
const mockCreateDashboardClient = vi.fn();

vi.mock('../../../../../src/cli/dashboard/_shared/config.js', () => ({
	loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

vi.mock('../../../../../src/cli/dashboard/_shared/client.js', () => ({
	createDashboardClient: (...args: unknown[]) => mockCreateDashboardClient(...args),
}));

vi.mock('chalk', () => ({
	default: {
		bold: (s: string) => s,
		blue: (s: string) => s,
		green: (s: string) => s,
		red: (s: string) => s,
		yellow: (s: string) => s,
		dim: (s: string) => s,
	},
}));

import WebhooksCreate from '../../../../../src/cli/dashboard/webhooks/create.js';
import WebhooksDelete from '../../../../../src/cli/dashboard/webhooks/delete.js';
import WebhooksList from '../../../../../src/cli/dashboard/webhooks/list.js';

// oclif's Command.parse() calls this.config.runHook internally
const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

const baseConfig = { serverUrl: 'http://localhost:3001', sessionToken: 'tok' };

function makeClient(overrides: Record<string, unknown> = {}) {
	return {
		webhooks: {
			list: {
				query: vi.fn().mockResolvedValue({
					trello: [],
					github: [],
					jira: [],
					errors: {},
				}),
			},
			create: {
				mutate: vi.fn().mockResolvedValue({
					trello: { id: 'trello-wh-1', callbackURL: 'http://localhost:3001/webhook/trello' },
					github: { id: 123, config: { url: 'http://localhost:3001/webhook/github' } },
					jira: null,
				}),
			},
			delete: {
				mutate: vi.fn().mockResolvedValue({
					trello: ['trello-wh-1'],
					github: [123],
					jira: [],
				}),
			},
		},
		...overrides,
	};
}

describe('WebhooksList (webhooks list)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('lists webhooks for project ID', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhooksList(['my-project'], oclifConfig as never);
		await cmd.run();

		expect(client.webhooks.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
			callbackBaseUrl: 'http://localhost:3001',
			oneTimeTokens: undefined,
		});
	});

	it('passes --github-token as oneTimeTokens when provided', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhooksList(
			['my-project', '--github-token', 'ghp_testtoken123'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.webhooks.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
			callbackBaseUrl: 'http://localhost:3001',
			oneTimeTokens: { github: 'ghp_testtoken123' },
		});
	});

	it('passes multiple one-time tokens when provided', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhooksList(
			[
				'my-project',
				'--github-token',
				'ghp_testtoken123',
				'--trello-api-key',
				'trello-key',
				'--trello-token',
				'trello-token',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.webhooks.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
			callbackBaseUrl: 'http://localhost:3001',
			oneTimeTokens: {
				github: 'ghp_testtoken123',
				trelloApiKey: 'trello-key',
				trelloToken: 'trello-token',
			},
		});
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhooksList(['my-project', '--json'], oclifConfig as never);
		await cmd.run();

		expect(client.webhooks.list.query).toHaveBeenCalled();
	});

	it('requires project ID argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new WebhooksList([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

describe('WebhooksCreate (webhooks create)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('creates webhooks for project ID using server URL as callback base', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhooksCreate(['my-project'], oclifConfig as never);
		await cmd.run();

		expect(client.webhooks.create.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			callbackBaseUrl: baseConfig.serverUrl,
			trelloOnly: false,
			githubOnly: false,
			oneTimeTokens: undefined,
		});
	});

	it('passes --callback-url when provided', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhooksCreate(
			['my-project', '--callback-url', 'https://cascade.example.com'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.webhooks.create.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			callbackBaseUrl: 'https://cascade.example.com',
			trelloOnly: false,
			githubOnly: false,
			oneTimeTokens: undefined,
		});
	});

	it('passes --github-token as oneTimeTokens when provided', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhooksCreate(
			['my-project', '--github-token', 'ghp_testtoken123'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.webhooks.create.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			callbackBaseUrl: baseConfig.serverUrl,
			trelloOnly: false,
			githubOnly: false,
			oneTimeTokens: { github: 'ghp_testtoken123' },
		});
	});

	it('passes --trello-only flag correctly', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhooksCreate(['my-project', '--trello-only'], oclifConfig as never);
		await cmd.run();

		expect(client.webhooks.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({ trelloOnly: true, githubOnly: false }),
		);
	});

	it('requires project ID argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new WebhooksCreate([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

describe('WebhooksDelete (webhooks delete)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('deletes webhooks for project ID using server URL as callback base', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhooksDelete(['my-project'], oclifConfig as never);
		await cmd.run();

		expect(client.webhooks.delete.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			callbackBaseUrl: baseConfig.serverUrl,
			trelloOnly: false,
			githubOnly: false,
			oneTimeTokens: undefined,
		});
	});

	it('passes --callback-url when provided', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhooksDelete(
			['my-project', '--callback-url', 'https://cascade.example.com'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.webhooks.delete.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			callbackBaseUrl: 'https://cascade.example.com',
			trelloOnly: false,
			githubOnly: false,
			oneTimeTokens: undefined,
		});
	});

	it('passes --github-token as oneTimeTokens when provided', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhooksDelete(
			['my-project', '--github-token', 'ghp_testtoken123'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.webhooks.delete.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			callbackBaseUrl: baseConfig.serverUrl,
			trelloOnly: false,
			githubOnly: false,
			oneTimeTokens: { github: 'ghp_testtoken123' },
		});
	});

	it('passes --github-only flag correctly', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhooksDelete(['my-project', '--github-only'], oclifConfig as never);
		await cmd.run();

		expect(client.webhooks.delete.mutate).toHaveBeenCalledWith(
			expect.objectContaining({ trelloOnly: false, githubOnly: true }),
		);
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhooksDelete(['my-project', '--json'], oclifConfig as never);
		await cmd.run();

		expect(client.webhooks.delete.mutate).toHaveBeenCalled();
	});

	it('requires project ID argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new WebhooksDelete([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

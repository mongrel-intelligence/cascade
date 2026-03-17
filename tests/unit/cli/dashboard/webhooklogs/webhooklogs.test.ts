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

import WebhookLogsList from '../../../../../src/cli/dashboard/webhooklogs/list.js';
import WebhookLogsShow from '../../../../../src/cli/dashboard/webhooklogs/show.js';

// oclif's Command.parse() calls this.config.runHook internally
const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

const baseConfig = { serverUrl: 'http://localhost:3001', sessionToken: 'tok' };

const sampleLog = {
	id: 'abc12345-0000-0000-0000-000000000000',
	source: 'github',
	method: 'POST',
	path: '/webhook/github',
	eventType: 'push',
	statusCode: 200,
	processed: true,
	projectId: 'my-project',
	decisionReason: 'handled',
	receivedAt: new Date('2024-01-01T00:00:00Z'),
	headers: { 'x-github-event': 'push' },
	body: { action: 'push' },
	bodyRaw: null,
};

function makeClient(overrides: Record<string, unknown> = {}) {
	return {
		webhookLogs: {
			list: {
				query: vi.fn().mockResolvedValue({ data: [sampleLog], total: 1 }),
			},
			getById: {
				query: vi.fn().mockResolvedValue(sampleLog),
			},
		},
		...overrides,
	};
}

describe('WebhookLogsList (webhooklogs list)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('lists webhook logs with default parameters', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhookLogsList([], oclifConfig as never);
		await cmd.run();

		expect(client.webhookLogs.list.query).toHaveBeenCalledWith({
			source: undefined,
			eventType: undefined,
			limit: 50,
			offset: 0,
		});
	});

	it('passes --source filter to query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhookLogsList(['--source', 'github'], oclifConfig as never);
		await cmd.run();

		expect(client.webhookLogs.list.query).toHaveBeenCalledWith({
			source: 'github',
			eventType: undefined,
			limit: 50,
			offset: 0,
		});
	});

	it('passes --event-type filter to query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhookLogsList(['--event-type', 'push'], oclifConfig as never);
		await cmd.run();

		expect(client.webhookLogs.list.query).toHaveBeenCalledWith({
			source: undefined,
			eventType: 'push',
			limit: 50,
			offset: 0,
		});
	});

	it('passes --limit filter to query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhookLogsList(['--limit', '10'], oclifConfig as never);
		await cmd.run();

		expect(client.webhookLogs.list.query).toHaveBeenCalledWith({
			source: undefined,
			eventType: undefined,
			limit: 10,
			offset: 0,
		});
	});

	it('passes combined filters to query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhookLogsList(
			['--source', 'trello', '--event-type', 'card-moved', '--limit', '20'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.webhookLogs.list.query).toHaveBeenCalledWith({
			source: 'trello',
			eventType: 'card-moved',
			limit: 20,
			offset: 0,
		});
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhookLogsList(['--json'], oclifConfig as never);
		await cmd.run();

		expect(client.webhookLogs.list.query).toHaveBeenCalled();
	});
});

describe('WebhookLogsShow (webhooklogs show)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('queries log by ID and displays detail', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhookLogsShow(['abc12345-0000-0000-0000-000000000000'], oclifConfig as never);
		await cmd.run();

		expect(client.webhookLogs.getById.query).toHaveBeenCalledWith({
			id: 'abc12345-0000-0000-0000-000000000000',
		});
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new WebhookLogsShow(
			['abc12345-0000-0000-0000-000000000000', '--json'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.webhookLogs.getById.query).toHaveBeenCalledWith({
			id: 'abc12345-0000-0000-0000-000000000000',
		});
	});

	it('requires a log ID argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new WebhookLogsShow([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

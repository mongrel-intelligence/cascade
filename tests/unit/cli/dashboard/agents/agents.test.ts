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

import AgentsCreate from '../../../../../src/cli/dashboard/agents/create.js';
import AgentsDelete from '../../../../../src/cli/dashboard/agents/delete.js';
import AgentsList from '../../../../../src/cli/dashboard/agents/list.js';
import AgentsUpdate from '../../../../../src/cli/dashboard/agents/update.js';

// oclif's Command.parse() calls this.config.runHook internally
const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

const sampleAgentConfig = {
	id: 1,
	agentType: 'implementation',
	projectId: 'my-project',
	model: 'claude-sonnet-4-5-20250929',
	maxIterations: 50,
	agentEngine: 'claude-code',
	maxConcurrency: null,
	prompt: null,
};

function makeClient(overrides: Record<string, unknown> = {}) {
	return {
		agentConfigs: {
			list: { query: vi.fn().mockResolvedValue([]) },
			create: { mutate: vi.fn().mockResolvedValue(sampleAgentConfig) },
			update: { mutate: vi.fn().mockResolvedValue(undefined) },
			delete: { mutate: vi.fn().mockResolvedValue(undefined) },
		},
		...overrides,
	};
}

const baseConfig = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };

// ---------------------------------------------------------------------------
// agents list
// ---------------------------------------------------------------------------
describe('AgentsList (list)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes --project-id to client.agentConfigs.list.query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsList(['--project-id', 'my-project'], oclifConfig as never);
		await cmd.run();

		expect(client.agentConfigs.list.query).toHaveBeenCalledWith({ projectId: 'my-project' });
	});

	it('calls list query with --json flag', async () => {
		const client = makeClient();
		(client.agentConfigs.list.query as ReturnType<typeof vi.fn>).mockResolvedValue([
			sampleAgentConfig,
		]);
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsList(['--project-id', 'my-project', '--json'], oclifConfig as never);
		await cmd.run();

		expect(client.agentConfigs.list.query).toHaveBeenCalledWith({ projectId: 'my-project' });
	});

	it('handles empty agent config list', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsList(['--project-id', 'my-project'], oclifConfig as never);
		await expect(cmd.run()).resolves.toBeUndefined();
	});

	it('requires --project-id flag', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new AgentsList([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// agents create
// ---------------------------------------------------------------------------
describe('AgentsCreate (create)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes --agent-type and --project-id to client.agentConfigs.create.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsCreate(
			['--agent-type', 'implementation', '--project-id', 'my-project'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentConfigs.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				agentType: 'implementation',
				projectId: 'my-project',
			}),
		);
	});

	it('passes optional --model flag to mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsCreate(
			[
				'--agent-type',
				'implementation',
				'--project-id',
				'my-project',
				'--model',
				'claude-sonnet-4-5-20250929',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentConfigs.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				agentType: 'implementation',
				projectId: 'my-project',
				model: 'claude-sonnet-4-5-20250929',
			}),
		);
	});

	it('passes optional --engine flag to mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsCreate(
			['--agent-type', 'review', '--project-id', 'my-project', '--engine', 'claude-code'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentConfigs.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				agentType: 'review',
				projectId: 'my-project',
				agentEngine: 'claude-code',
			}),
		);
	});

	it('passes all optional flags together', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsCreate(
			[
				'--agent-type',
				'implementation',
				'--project-id',
				'my-project',
				'--model',
				'claude-sonnet-4-5-20250929',
				'--engine',
				'llmist',
				'--max-iterations',
				'30',
				'--max-concurrency',
				'2',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentConfigs.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				agentType: 'implementation',
				projectId: 'my-project',
				model: 'claude-sonnet-4-5-20250929',
				agentEngine: 'llmist',
				maxIterations: 30,
				maxConcurrency: 2,
			}),
		);
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsCreate(
			['--agent-type', 'implementation', '--project-id', 'my-project', '--json'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentConfigs.create.mutate).toHaveBeenCalled();
	});

	it('requires --agent-type and --project-id flags', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new AgentsCreate(['--agent-type', 'implementation'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// agents update
// ---------------------------------------------------------------------------
describe('AgentsUpdate (update)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes ID with --model flag to client.agentConfigs.update.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsUpdate(
			['1', '--model', 'claude-sonnet-4-5-20250929'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentConfigs.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 1,
				model: 'claude-sonnet-4-5-20250929',
			}),
		);
	});

	it('passes ID with --max-iterations flag to mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsUpdate(['1', '--max-iterations', '25'], oclifConfig as never);
		await cmd.run();

		expect(client.agentConfigs.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 1,
				maxIterations: 25,
			}),
		);
	});

	it('passes ID with --engine flag to mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsUpdate(['1', '--engine', 'claude-code'], oclifConfig as never);
		await cmd.run();

		expect(client.agentConfigs.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 1,
				agentEngine: 'claude-code',
			}),
		);
	});

	it('passes multiple update flags together', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsUpdate(
			[
				'1',
				'--model',
				'claude-sonnet-4-5-20250929',
				'--max-iterations',
				'40',
				'--engine',
				'llmist',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentConfigs.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 1,
				model: 'claude-sonnet-4-5-20250929',
				maxIterations: 40,
				agentEngine: 'llmist',
			}),
		);
	});

	it('requires ID argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new AgentsUpdate(['--model', 'claude-sonnet-4-5-20250929'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// agents delete
// ---------------------------------------------------------------------------
describe('AgentsDelete (delete)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes ID with --yes flag to client.agentConfigs.delete.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsDelete(['1', '--yes'], oclifConfig as never);
		await cmd.run();

		expect(client.agentConfigs.delete.mutate).toHaveBeenCalledWith({ id: 1 });
	});

	it('auto-accepts without --yes in non-TTY environments', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new AgentsDelete(['1'], oclifConfig as never);
		await expect(cmd.run()).resolves.toBeUndefined();
		expect(client.agentConfigs.delete.mutate).toHaveBeenCalledWith({ id: 1 });
	});

	it('requires ID argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new AgentsDelete(['--yes'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

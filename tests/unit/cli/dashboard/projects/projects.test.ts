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

import ProjectsCreate from '../../../../../src/cli/dashboard/projects/create.js';
import ProjectsDelete from '../../../../../src/cli/dashboard/projects/delete.js';
import ProjectsIntegrationSet from '../../../../../src/cli/dashboard/projects/integration-set.js';
import ProjectsIntegrations from '../../../../../src/cli/dashboard/projects/integrations.js';
import ProjectsList from '../../../../../src/cli/dashboard/projects/list.js';
import ProjectsShow from '../../../../../src/cli/dashboard/projects/show.js';
import ProjectsTriggerDiscover from '../../../../../src/cli/dashboard/projects/trigger-discover.js';
import ProjectsTriggerList from '../../../../../src/cli/dashboard/projects/trigger-list.js';
import ProjectsTriggerSet from '../../../../../src/cli/dashboard/projects/trigger-set.js';
import ProjectsUpdate from '../../../../../src/cli/dashboard/projects/update.js';

// oclif's Command.parse() calls this.config.runHook internally
const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

const sampleProject = {
	id: 'my-project',
	name: 'My Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'cascade/',
	model: 'claude-sonnet-4-5-20250929',
	agentEngine: 'claude-code',
	workItemBudgetUsd: '5.00',
	maxInFlightItems: 3,
};

function makeClient(overrides: Record<string, unknown> = {}) {
	return {
		projects: {
			listFull: { query: vi.fn().mockResolvedValue([]) },
			getById: { query: vi.fn().mockResolvedValue(sampleProject) },
			create: { mutate: vi.fn().mockResolvedValue(sampleProject) },
			update: { mutate: vi.fn().mockResolvedValue(undefined) },
			delete: { mutate: vi.fn().mockResolvedValue(undefined) },
			integrations: {
				list: { query: vi.fn().mockResolvedValue([]) },
				upsert: { mutate: vi.fn().mockResolvedValue(undefined) },
			},
		},
		agentDefinitions: {
			get: {
				query: vi.fn().mockResolvedValue({
					definition: {
						triggers: [
							{
								event: 'pm:status-changed',
								label: 'PM Status Changed',
								defaultEnabled: true,
								description: 'Fires when a card moves to a target status',
							},
						],
					},
				}),
			},
		},
		agentTriggerConfigs: {
			listByProject: { query: vi.fn().mockResolvedValue([]) },
			listByProjectAndAgent: { query: vi.fn().mockResolvedValue([]) },
			upsert: {
				mutate: vi.fn().mockResolvedValue({
					enabled: true,
					parameters: {},
				}),
			},
		},
		...overrides,
	};
}

const baseConfig = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };

// ---------------------------------------------------------------------------
// projects list
// ---------------------------------------------------------------------------
describe('ProjectsList (list)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('calls client.projects.listFull.query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsList([], oclifConfig as never);
		await cmd.run();

		expect(client.projects.listFull.query).toHaveBeenCalledWith();
	});

	it('calls client.projects.listFull.query with --json flag', async () => {
		const client = makeClient();
		(client.projects.listFull.query as ReturnType<typeof vi.fn>).mockResolvedValue([sampleProject]);
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsList(['--json'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.listFull.query).toHaveBeenCalledWith();
	});

	it('handles empty project list', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsList([], oclifConfig as never);
		await expect(cmd.run()).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// projects show
// ---------------------------------------------------------------------------
describe('ProjectsShow (show)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes project ID to getById query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsShow(['my-project'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.getById.query).toHaveBeenCalledWith({ id: 'my-project' });
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsShow(['my-project', '--json'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.getById.query).toHaveBeenCalledWith({ id: 'my-project' });
	});

	it('requires project ID argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new ProjectsShow([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// projects create
// ---------------------------------------------------------------------------
describe('ProjectsCreate (create)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes --id, --name, --repo flags to client.projects.create.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsCreate(
			['--id', 'new-project', '--name', 'New Project', '--repo', 'owner/repo'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'new-project',
				name: 'New Project',
				repo: 'owner/repo',
			}),
		);
	});

	it('passes optional flags when provided', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsCreate(
			[
				'--id',
				'new-project',
				'--name',
				'New Project',
				'--repo',
				'owner/repo',
				'--base-branch',
				'develop',
				'--agent-engine',
				'claude-code',
				'--max-iterations',
				'30',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'new-project',
				name: 'New Project',
				repo: 'owner/repo',
				baseBranch: 'develop',
				agentEngine: 'claude-code',
				maxIterations: 30,
			}),
		);
	});

	it('requires --id, --name, and --repo flags', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new ProjectsCreate(['--id', 'new-project'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// projects update
// ---------------------------------------------------------------------------
describe('ProjectsUpdate (update)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes model flag to update mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(
			['my-project', '--model', 'claude-sonnet-4-5-20250929'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'my-project',
				model: 'claude-sonnet-4-5-20250929',
			}),
		);
	});

	it('passes max-iterations flag to update mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(['my-project', '--max-iterations', '25'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'my-project',
				maxIterations: 25,
			}),
		);
	});

	it('passes agent-engine flag to update mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(
			['my-project', '--agent-engine', 'claude-code'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'my-project',
				agentEngine: 'claude-code',
			}),
		);
	});

	it('passes run-links-enabled boolean flag to update mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(['my-project', '--run-links-enabled'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'my-project',
				runLinksEnabled: true,
			}),
		);
	});

	it('passes --no-run-links-enabled to update mutate as false', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(['my-project', '--no-run-links-enabled'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'my-project',
				runLinksEnabled: false,
			}),
		);
	});

	it('passes numeric flags (work-item-budget, watchdog-timeout, max-in-flight-items)', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(
			[
				'my-project',
				'--work-item-budget',
				'10',
				'--watchdog-timeout',
				'1800000',
				'--max-in-flight-items',
				'3',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'my-project',
				workItemBudgetUsd: '10',
				watchdogTimeoutMs: 1800000,
				maxInFlightItems: 3,
			}),
		);
	});

	it('passes progress-model and progress-interval flags', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(
			[
				'my-project',
				'--progress-model',
				'openrouter:google/gemini-2.5-flash-lite',
				'--progress-interval',
				'5',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'my-project',
				progressModel: 'openrouter:google/gemini-2.5-flash-lite',
				progressIntervalMinutes: '5',
			}),
		);
	});

	it('does not include runLinksEnabled when flag is absent', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsUpdate(
			['my-project', '--model', 'claude-sonnet-4-5-20250929'],
			oclifConfig as never,
		);
		await cmd.run();

		const callArg = (client.projects.update.mutate as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(callArg).not.toHaveProperty('runLinksEnabled');
	});
});

// ---------------------------------------------------------------------------
// projects delete
// ---------------------------------------------------------------------------
describe('ProjectsDelete (delete)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes project ID with --yes flag and calls client.projects.delete.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsDelete(['my-project', '--yes'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.delete.mutate).toHaveBeenCalledWith({ id: 'my-project' });
	});

	it('auto-accepts without --yes in non-TTY environments', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsDelete(['my-project'], oclifConfig as never);
		await expect(cmd.run()).resolves.toBeUndefined();
		expect(client.projects.delete.mutate).toHaveBeenCalledWith({ id: 'my-project' });
	});

	it('requires project ID argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new ProjectsDelete(['--yes'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// projects integrations
// ---------------------------------------------------------------------------
describe('ProjectsIntegrations (integrations)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes project ID to integrations list query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrations(['my-project'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.integrations.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
		});
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		(client.projects.integrations.list.query as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ category: 'pm', provider: 'trello', config: { boardId: 'abc' }, triggers: {} },
		]);
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrations(['my-project', '--json'], oclifConfig as never);
		await cmd.run();

		expect(client.projects.integrations.list.query).toHaveBeenCalledWith({
			projectId: 'my-project',
		});
	});

	it('handles empty integrations list', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrations(['my-project'], oclifConfig as never);
		await expect(cmd.run()).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// projects integration-set
// ---------------------------------------------------------------------------
describe('ProjectsIntegrationSet (integration-set)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes project ID, category, provider, and config JSON to integrations upsert', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const config = JSON.stringify({ boardId: 'BOARD123', lists: { todo: 'LIST1' } });
		const cmd = new ProjectsIntegrationSet(
			['my-project', '--category', 'pm', '--provider', 'trello', '--config', config],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.integrations.upsert.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'pm',
			provider: 'trello',
			config: { boardId: 'BOARD123', lists: { todo: 'LIST1' } },
			triggers: undefined,
		});
	});

	it('passes triggers JSON when --triggers flag is provided', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const config = JSON.stringify({ boardId: 'BOARD123' });
		const triggers = JSON.stringify({ 'pm:status-changed': true });
		const cmd = new ProjectsIntegrationSet(
			[
				'my-project',
				'--category',
				'pm',
				'--provider',
				'trello',
				'--config',
				config,
				'--triggers',
				triggers,
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.integrations.upsert.mutate).toHaveBeenCalledWith({
			projectId: 'my-project',
			category: 'pm',
			provider: 'trello',
			config: { boardId: 'BOARD123' },
			triggers: { 'pm:status-changed': true },
		});
	});

	it('sets scm/github integration', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const config = JSON.stringify({ repo: 'owner/repo' });
		const cmd = new ProjectsIntegrationSet(
			['my-project', '--category', 'scm', '--provider', 'github', '--config', config],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.projects.integrations.upsert.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				category: 'scm',
				provider: 'github',
			}),
		);
	});

	it('errors on invalid JSON in --config flag', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsIntegrationSet(
			['my-project', '--category', 'pm', '--provider', 'trello', '--config', 'not-valid-json'],
			oclifConfig as never,
		);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// projects trigger-discover
// ---------------------------------------------------------------------------
describe('ProjectsTriggerDiscover (trigger-discover)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes agent type and queries agentDefinitions.get', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerDiscover(['--agent', 'implementation'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.get.query).toHaveBeenCalledWith({
			agentType: 'implementation',
		});
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerDiscover(
			['--agent', 'implementation', '--json'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentDefinitions.get.query).toHaveBeenCalledWith({
			agentType: 'implementation',
		});
	});

	it('handles agent with no triggers', async () => {
		const client = makeClient();
		(client.agentDefinitions.get.query as ReturnType<typeof vi.fn>).mockResolvedValue({
			definition: { triggers: [] },
		});
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerDiscover(['--agent', 'debug'], oclifConfig as never);
		await expect(cmd.run()).resolves.toBeUndefined();
	});

	it('errors when agent type is unknown (definition returns null)', async () => {
		const client = makeClient();
		(client.agentDefinitions.get.query as ReturnType<typeof vi.fn>).mockResolvedValue(null);
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerDiscover(['--agent', 'nonexistent'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});

	it('requires --agent flag', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new ProjectsTriggerDiscover([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// projects trigger-list
// ---------------------------------------------------------------------------
describe('ProjectsTriggerList (trigger-list)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes project ID to listByProject query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerList(['my-project'], oclifConfig as never);
		await cmd.run();

		expect(client.agentTriggerConfigs.listByProject.query).toHaveBeenCalledWith({
			projectId: 'my-project',
		});
	});

	it('passes project ID and agent filter to listByProjectAndAgent query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerList(['my-project', '--agent', 'review'], oclifConfig as never);
		await cmd.run();

		expect(client.agentTriggerConfigs.listByProjectAndAgent.query).toHaveBeenCalledWith({
			projectId: 'my-project',
			agentType: 'review',
		});
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		(client.agentTriggerConfigs.listByProject.query as ReturnType<typeof vi.fn>).mockResolvedValue([
			{
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
				parameters: {},
			},
		]);
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerList(['my-project', '--json'], oclifConfig as never);
		await cmd.run();

		expect(client.agentTriggerConfigs.listByProject.query).toHaveBeenCalledWith({
			projectId: 'my-project',
		});
	});

	it('handles empty trigger list', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerList(['my-project'], oclifConfig as never);
		await expect(cmd.run()).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// projects trigger-set
// ---------------------------------------------------------------------------
describe('ProjectsTriggerSet (trigger-set)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('enables a trigger with --enable flag', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerSet(
			['my-project', '--agent', 'implementation', '--event', 'pm:status-changed', '--enable'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentTriggerConfigs.upsert.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'my-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
			}),
		);
	});

	it('disables a trigger with --disable flag', async () => {
		const client = makeClient();
		(client.agentTriggerConfigs.upsert.mutate as ReturnType<typeof vi.fn>).mockResolvedValue({
			enabled: false,
			parameters: {},
		});
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerSet(
			['my-project', '--agent', 'review', '--event', 'scm:check-suite-success', '--disable'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentTriggerConfigs.upsert.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'my-project',
				agentType: 'review',
				triggerEvent: 'scm:check-suite-success',
				enabled: false,
			}),
		);
	});

	it('passes --params JSON to upsert', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerSet(
			[
				'my-project',
				'--agent',
				'review',
				'--event',
				'scm:check-suite-success',
				'--enable',
				'--params',
				'{"authorMode":"own"}',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentTriggerConfigs.upsert.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'my-project',
				agentType: 'review',
				triggerEvent: 'scm:check-suite-success',
				enabled: true,
				parameters: { authorMode: 'own' },
			}),
		);
	});

	it('sets params without enable/disable when only --params is provided', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerSet(
			[
				'my-project',
				'--agent',
				'review',
				'--event',
				'scm:check-suite-success',
				'--params',
				'{"authorMode":"external"}',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentTriggerConfigs.upsert.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'my-project',
				agentType: 'review',
				triggerEvent: 'scm:check-suite-success',
				enabled: undefined,
				parameters: { authorMode: 'external' },
			}),
		);
	});

	it('errors when neither --enable, --disable, nor --params is provided', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerSet(
			['my-project', '--agent', 'implementation', '--event', 'pm:status-changed'],
			oclifConfig as never,
		);
		await expect(cmd.run()).rejects.toThrow();
	});

	it('errors on invalid event format', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerSet(
			['my-project', '--agent', 'implementation', '--event', 'invalid-event-format', '--enable'],
			oclifConfig as never,
		);
		await expect(cmd.run()).rejects.toThrow();
	});

	it('errors on invalid JSON in --params flag', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerSet(
			[
				'my-project',
				'--agent',
				'implementation',
				'--event',
				'pm:status-changed',
				'--params',
				'not-valid-json',
			],
			oclifConfig as never,
		);
		await expect(cmd.run()).rejects.toThrow();
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new ProjectsTriggerSet(
			[
				'my-project',
				'--agent',
				'implementation',
				'--event',
				'pm:status-changed',
				'--enable',
				'--json',
			],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentTriggerConfigs.upsert.mutate).toHaveBeenCalled();
	});
});

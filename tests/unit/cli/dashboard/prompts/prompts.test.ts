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

vi.mock('node:fs', () => ({
	readFileSync: vi.fn().mockReturnValue('template content'),
}));

import PromptsDefaultPartial from '../../../../../src/cli/dashboard/prompts/default-partial.js';
import PromptsDefault from '../../../../../src/cli/dashboard/prompts/default.js';
import PromptsGetPartial from '../../../../../src/cli/dashboard/prompts/get-partial.js';
import PromptsListPartials from '../../../../../src/cli/dashboard/prompts/list-partials.js';
import PromptsResetPartial from '../../../../../src/cli/dashboard/prompts/reset-partial.js';
import PromptsSetPartial from '../../../../../src/cli/dashboard/prompts/set-partial.js';
import PromptsValidate from '../../../../../src/cli/dashboard/prompts/validate.js';
import PromptsVariables from '../../../../../src/cli/dashboard/prompts/variables.js';

// oclif's Command.parse() calls this.config.runHook internally
const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

const baseConfig = { serverUrl: 'http://localhost:3001', sessionToken: 'tok' };

function makeClient(overrides: Record<string, unknown> = {}) {
	return {
		prompts: {
			getDefault: { query: vi.fn().mockResolvedValue({ content: 'default template content' }) },
			getDefaultPartial: {
				query: vi.fn().mockResolvedValue({ content: 'default partial content' }),
			},
			variables: {
				query: vi
					.fn()
					.mockResolvedValue([
						{ name: 'workItemTitle', group: 'work-item', description: 'Title of the work item' },
					]),
			},
			listPartials: {
				query: vi.fn().mockResolvedValue([
					{ name: 'git', source: 'disk', lines: 20 },
					{ name: 'tmux', source: 'db', lines: 15 },
				]),
			},
			getPartial: {
				query: vi
					.fn()
					.mockResolvedValue({ name: 'git', content: 'partial content', source: 'disk', id: null }),
			},
			upsertPartial: {
				mutate: vi.fn().mockResolvedValue({ id: 42, name: 'git' }),
			},
			deletePartial: {
				mutate: vi.fn().mockResolvedValue(undefined),
			},
			validate: {
				mutate: vi.fn().mockResolvedValue({ valid: true }),
			},
		},
		...overrides,
	};
}

describe('PromptsDefault (prompts default)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('queries default template for given agent-type', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new PromptsDefault(['--agent-type', 'implementation'], oclifConfig as never);
		await cmd.run();

		expect(client.prompts.getDefault.query).toHaveBeenCalledWith({
			agentType: 'implementation',
		});
	});

	it('requires --agent-type flag', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new PromptsDefault([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

describe('PromptsDefaultPartial (prompts default-partial)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('queries default partial content for given name', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new PromptsDefaultPartial(['--name', 'git'], oclifConfig as never);
		await cmd.run();

		expect(client.prompts.getDefaultPartial.query).toHaveBeenCalledWith({ name: 'git' });
	});

	it('requires --name flag', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new PromptsDefaultPartial([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

describe('PromptsVariables (prompts variables)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('lists available template variables', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new PromptsVariables([], oclifConfig as never);
		await cmd.run();

		expect(client.prompts.variables.query).toHaveBeenCalled();
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new PromptsVariables(['--json'], oclifConfig as never);
		await cmd.run();

		expect(client.prompts.variables.query).toHaveBeenCalled();
	});
});

describe('PromptsListPartials (prompts list-partials)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('queries all partials and outputs table', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new PromptsListPartials([], oclifConfig as never);
		await cmd.run();

		expect(client.prompts.listPartials.query).toHaveBeenCalled();
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new PromptsListPartials(['--json'], oclifConfig as never);
		await cmd.run();

		expect(client.prompts.listPartials.query).toHaveBeenCalled();
	});
});

describe('PromptsGetPartial (prompts get-partial)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('queries partial content for given name', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new PromptsGetPartial(['--name', 'git'], oclifConfig as never);
		await cmd.run();

		expect(client.prompts.getPartial.query).toHaveBeenCalledWith({ name: 'git' });
	});

	it('requires --name flag', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new PromptsGetPartial([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

describe('PromptsSetPartial (prompts set-partial)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('upserts partial with name and file content', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new PromptsSetPartial(
			['--name', 'git', '--file', '/some/path/git.eta'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.prompts.upsertPartial.mutate).toHaveBeenCalledWith({
			name: 'git',
			content: 'template content',
		});
	});

	it('requires --name and --file flags', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new PromptsSetPartial(['--name', 'git'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

describe('PromptsResetPartial (prompts reset-partial)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('deletes a DB partial to revert to disk default', async () => {
		const client = makeClient();
		(client.prompts.getPartial.query as ReturnType<typeof vi.fn>).mockResolvedValue({
			name: 'git',
			content: 'db content',
			source: 'db',
			id: 42,
		});
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new PromptsResetPartial(['--name', 'git'], oclifConfig as never);
		await cmd.run();

		expect(client.prompts.getPartial.query).toHaveBeenCalledWith({ name: 'git' });
		expect(client.prompts.deletePartial.mutate).toHaveBeenCalledWith({ id: 42 });
	});

	it('skips deletion when partial is already using disk default', async () => {
		const client = makeClient();
		// Default mock already returns source: 'disk'
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new PromptsResetPartial(['--name', 'tmux'], oclifConfig as never);
		await cmd.run();

		expect(client.prompts.getPartial.query).toHaveBeenCalledWith({ name: 'tmux' });
		expect(client.prompts.deletePartial.mutate).not.toHaveBeenCalled();
	});

	it('requires --name flag', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new PromptsResetPartial([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

describe('PromptsValidate (prompts validate)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('validates template from file and reports valid', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new PromptsValidate(['--file', '/some/path/template.eta'], oclifConfig as never);
		await cmd.run();

		expect(client.prompts.validate.mutate).toHaveBeenCalledWith({ template: 'template content' });
	});

	it('outputs json when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new PromptsValidate(
			['--file', '/some/path/template.eta', '--json'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.prompts.validate.mutate).toHaveBeenCalledWith({ template: 'template content' });
	});

	it('requires --file flag', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new PromptsValidate([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

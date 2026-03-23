import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadConfig = vi.fn();
const mockCreateDashboardClient = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock('../../../../../src/cli/dashboard/_shared/config.js', () => ({
	loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

vi.mock('../../../../../src/cli/dashboard/_shared/client.js', () => ({
	createDashboardClient: (...args: unknown[]) => mockCreateDashboardClient(...args),
}));

vi.mock('node:fs', () => ({
	readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
	writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

vi.mock('js-yaml', () => ({
	load: (raw: string) => {
		// Simple YAML stub: parse key: value pairs
		const result: Record<string, unknown> = {};
		for (const line of raw.split('\n')) {
			const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
			if (m) result[m[1]] = m[2];
		}
		return result;
	},
	dump: (data: unknown) => JSON.stringify(data),
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

import DefinitionsCreate from '../../../../../src/cli/dashboard/definitions/create.js';
import DefinitionsDelete from '../../../../../src/cli/dashboard/definitions/delete.js';
import DefinitionsExport from '../../../../../src/cli/dashboard/definitions/export.js';
import DefinitionsImport from '../../../../../src/cli/dashboard/definitions/import.js';
import DefinitionsList from '../../../../../src/cli/dashboard/definitions/list.js';
import DefinitionsReset from '../../../../../src/cli/dashboard/definitions/reset.js';
import DefinitionsShow from '../../../../../src/cli/dashboard/definitions/show.js';
import DefinitionsTriggers from '../../../../../src/cli/dashboard/definitions/triggers.js';
import DefinitionsUpdate from '../../../../../src/cli/dashboard/definitions/update.js';

// oclif's Command.parse() calls this.config.runHook internally
const oclifConfig = {
	runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
};

const sampleDefinition = {
	identity: {
		label: 'Implementation Agent',
		emoji: '🔨',
		roleHint: 'Implements code changes',
	},
	triggers: [
		{
			event: 'pm:status-changed',
			label: 'Status Changed',
			providers: ['trello', 'jira'],
			defaultEnabled: true,
			parameters: [],
		},
		{
			event: 'scm:check-suite-success',
			label: 'CI Passed',
			providers: ['github'],
			defaultEnabled: false,
			parameters: [{ name: 'authorMode', type: 'select', options: ['own', 'external'] }],
		},
	],
};

const sampleDefinitionRow = {
	agentType: 'implementation',
	isBuiltin: true,
	definition: sampleDefinition,
};

function makeClient(overrides: Record<string, unknown> = {}) {
	return {
		agentDefinitions: {
			list: { query: vi.fn().mockResolvedValue([sampleDefinitionRow]) },
			get: { query: vi.fn().mockResolvedValue(sampleDefinitionRow) },
			create: { mutate: vi.fn().mockResolvedValue(sampleDefinitionRow) },
			update: { mutate: vi.fn().mockResolvedValue(sampleDefinitionRow) },
			delete: { mutate: vi.fn().mockResolvedValue({ agentType: 'my-custom-agent' }) },
			reset: { mutate: vi.fn().mockResolvedValue(sampleDefinitionRow) },
		},
		...overrides,
	};
}

const baseConfig = { serverUrl: 'http://localhost:3000', sessionToken: 'tok' };

// ---------------------------------------------------------------------------
// definitions list
// ---------------------------------------------------------------------------
describe('DefinitionsList (list)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('calls client.agentDefinitions.list.query and outputs table', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsList([], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.list.query).toHaveBeenCalledWith();
	});

	it('outputs JSON when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsList(['--json'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.list.query).toHaveBeenCalledWith();
	});

	it('handles empty definition list gracefully', async () => {
		const client = makeClient();
		(client.agentDefinitions.list.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsList([], oclifConfig as never);
		await expect(cmd.run()).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// definitions show
// ---------------------------------------------------------------------------
describe('DefinitionsShow (show)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes agent type arg to client.agentDefinitions.get.query', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsShow(['implementation'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.get.query).toHaveBeenCalledWith({
			agentType: 'implementation',
		});
	});

	it('displays definition detail in text output', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsShow(['implementation'], oclifConfig as never);
		await expect(cmd.run()).resolves.toBeUndefined();
		expect(client.agentDefinitions.get.query).toHaveBeenCalledWith({
			agentType: 'implementation',
		});
	});

	it('outputs JSON when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsShow(['implementation', '--json'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.get.query).toHaveBeenCalledWith({
			agentType: 'implementation',
		});
	});

	it('requires agentType argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new DefinitionsShow([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// definitions create
// ---------------------------------------------------------------------------
describe('DefinitionsCreate (create)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
		mockReadFileSync.mockReturnValue(JSON.stringify(sampleDefinition));
	});

	it('reads JSON file and calls client.agentDefinitions.create.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);
		mockReadFileSync.mockReturnValue(JSON.stringify(sampleDefinition));

		const cmd = new DefinitionsCreate(
			['--agent-type', 'my-agent', '--file', 'definition.json'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(mockReadFileSync).toHaveBeenCalledWith('definition.json', 'utf-8');
		expect(client.agentDefinitions.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				agentType: 'my-agent',
				definition: sampleDefinition,
			}),
		);
	});

	it('reads YAML file (non-JSON content) and calls mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);
		// YAML content (not starting with { or [)
		mockReadFileSync.mockReturnValue('label: My Agent\nemoji: 🤖\n');

		const cmd = new DefinitionsCreate(
			['--agent-type', 'my-yaml-agent', '--file', 'definition.yaml'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(mockReadFileSync).toHaveBeenCalledWith('definition.yaml', 'utf-8');
		expect(client.agentDefinitions.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({ agentType: 'my-yaml-agent' }),
		);
	});

	it('outputs JSON when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsCreate(
			['--agent-type', 'my-agent', '--file', 'definition.json', '--json'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentDefinitions.create.mutate).toHaveBeenCalled();
	});

	it('requires --agent-type and --file flags', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new DefinitionsCreate(['--agent-type', 'my-agent'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// definitions update
// ---------------------------------------------------------------------------
describe('DefinitionsUpdate (update)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('reads JSON file and calls client.agentDefinitions.update.mutate with patch', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);
		mockReadFileSync.mockReturnValue(JSON.stringify({ identity: { label: 'Updated Label' } }));

		const cmd = new DefinitionsUpdate(
			['implementation', '--file', 'patch.json'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentDefinitions.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				agentType: 'implementation',
				patch: { identity: { label: 'Updated Label' } },
			}),
		);
	});

	it('reads YAML patch file and calls mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);
		mockReadFileSync.mockReturnValue('label: New Label\n');

		const cmd = new DefinitionsUpdate(
			['implementation', '--file', 'patch.yaml'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentDefinitions.update.mutate).toHaveBeenCalledWith(
			expect.objectContaining({ agentType: 'implementation' }),
		);
	});

	it('outputs JSON when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);
		mockReadFileSync.mockReturnValue(JSON.stringify({ identity: { label: 'Updated' } }));

		const cmd = new DefinitionsUpdate(
			['implementation', '--file', 'patch.json', '--json'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentDefinitions.update.mutate).toHaveBeenCalled();
	});

	it('requires agentType argument and --file flag', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new DefinitionsUpdate(['implementation'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// definitions delete
// ---------------------------------------------------------------------------
describe('DefinitionsDelete (delete)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes agent type with --yes flag to client.agentDefinitions.delete.mutate', async () => {
		const client = makeClient();
		(client.agentDefinitions.delete.mutate as ReturnType<typeof vi.fn>).mockResolvedValue({
			agentType: 'my-custom-agent',
		});
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsDelete(['my-custom-agent', '--yes'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.delete.mutate).toHaveBeenCalledWith({
			agentType: 'my-custom-agent',
		});
	});

	it('errors when --yes flag is missing', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsDelete(['my-custom-agent'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});

	it('outputs JSON when --json flag is set', async () => {
		const client = makeClient();
		(client.agentDefinitions.delete.mutate as ReturnType<typeof vi.fn>).mockResolvedValue({
			agentType: 'my-custom-agent',
		});
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsDelete(['my-custom-agent', '--yes', '--json'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.delete.mutate).toHaveBeenCalledWith({
			agentType: 'my-custom-agent',
		});
	});

	it('requires agentType argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new DefinitionsDelete(['--yes'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// definitions export
// ---------------------------------------------------------------------------
describe('DefinitionsExport (export)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('fetches single definition and writes YAML to stdout by default', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

		const cmd = new DefinitionsExport(['implementation', '--format', 'yaml'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.get.query).toHaveBeenCalledWith({
			agentType: 'implementation',
		});
		expect(stdoutSpy).toHaveBeenCalled();
		stdoutSpy.mockRestore();
	});

	it('fetches all definitions when no agentType is given', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

		const cmd = new DefinitionsExport(['--format', 'json'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.list.query).toHaveBeenCalledWith();
		stdoutSpy.mockRestore();
	});

	it('writes to file when --output flag is given', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsExport(
			['implementation', '--format', 'json', '--output', 'out.json'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(mockWriteFileSync).toHaveBeenCalledWith('out.json', expect.any(String), 'utf-8');
	});

	it('outputs YAML format when --format yaml is specified', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

		const cmd = new DefinitionsExport(['implementation', '--format', 'yaml'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.get.query).toHaveBeenCalledWith({
			agentType: 'implementation',
		});
		// Verify stdout was written (YAML output)
		expect(stdoutSpy).toHaveBeenCalled();
		stdoutSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// definitions import
// ---------------------------------------------------------------------------
describe('DefinitionsImport (import)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('(create path) successfully imports when definition does not exist', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);
		const fileContent = JSON.stringify({
			agentType: 'my-new-agent',
			definition: sampleDefinition,
		});
		mockReadFileSync.mockReturnValue(fileContent);

		const cmd = new DefinitionsImport(['--file', 'definition.json'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				agentType: 'my-new-agent',
			}),
		);
	});

	it('(upsert path) falls back to update when create returns conflict error with --update flag', async () => {
		const client = makeClient();
		// create throws conflict error
		(client.agentDefinitions.create.mutate as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error('already exists'),
		);
		// update succeeds
		(client.agentDefinitions.update.mutate as ReturnType<typeof vi.fn>).mockResolvedValue({
			agentType: 'my-agent',
			isBuiltin: false,
			definition: sampleDefinition,
		});
		mockCreateDashboardClient.mockReturnValue(client);
		const fileContent = JSON.stringify({
			agentType: 'my-agent',
			definition: sampleDefinition,
		});
		mockReadFileSync.mockReturnValue(fileContent);

		const cmd = new DefinitionsImport(
			['--file', 'definition.json', '--update'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentDefinitions.create.mutate).toHaveBeenCalled();
		expect(client.agentDefinitions.update.mutate).toHaveBeenCalled();
	});

	it('resolves agentType from file content when --agent-type flag is not set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);
		const fileContent = JSON.stringify({
			agentType: 'from-file-agent',
			definition: sampleDefinition,
		});
		mockReadFileSync.mockReturnValue(fileContent);

		const cmd = new DefinitionsImport(['--file', 'definition.json'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({ agentType: 'from-file-agent' }),
		);
	});

	it('--agent-type flag overrides agentType from file content', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);
		const fileContent = JSON.stringify({
			agentType: 'from-file-agent',
			definition: sampleDefinition,
		});
		mockReadFileSync.mockReturnValue(fileContent);

		const cmd = new DefinitionsImport(
			['--file', 'definition.json', '--agent-type', 'override-agent'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentDefinitions.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({ agentType: 'override-agent' }),
		);
	});

	it('parses YAML file content', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);
		// YAML content starting with non-{/[ char: our stub parse returns {agentType: 'yaml-agent'}
		mockReadFileSync.mockReturnValue('agentType: yaml-agent\n');

		const cmd = new DefinitionsImport(
			['--file', 'definition.yaml', '--agent-type', 'yaml-agent'],
			oclifConfig as never,
		);
		await cmd.run();

		expect(client.agentDefinitions.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({ agentType: 'yaml-agent' }),
		);
	});

	it('parses JSON file content', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);
		const fileContent = JSON.stringify({ agentType: 'json-agent', definition: sampleDefinition });
		mockReadFileSync.mockReturnValue(fileContent);

		const cmd = new DefinitionsImport(['--file', 'definition.json'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.create.mutate).toHaveBeenCalledWith(
			expect.objectContaining({ agentType: 'json-agent' }),
		);
	});

	it('errors when agentType not found in file and no --agent-type flag', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);
		// file has no agentType key
		mockReadFileSync.mockReturnValue(JSON.stringify({ definition: sampleDefinition }));

		const cmd = new DefinitionsImport(['--file', 'definition.json'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});

	it('requires --file flag', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new DefinitionsImport([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// definitions reset
// ---------------------------------------------------------------------------
describe('DefinitionsReset (reset)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes agent type with --yes flag to client.agentDefinitions.reset.mutate', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsReset(['implementation', '--yes'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.reset.mutate).toHaveBeenCalledWith({
			agentType: 'implementation',
		});
	});

	it('errors when --yes flag is missing', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsReset(['implementation'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});

	it('outputs JSON when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsReset(['implementation', '--yes', '--json'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.reset.mutate).toHaveBeenCalledWith({
			agentType: 'implementation',
		});
	});

	it('requires agentType argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new DefinitionsReset(['--yes'], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// definitions triggers
// ---------------------------------------------------------------------------
describe('DefinitionsTriggers (triggers)', () => {
	beforeEach(() => {
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it('passes agent type to client.agentDefinitions.get.query and displays supported triggers', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsTriggers(['implementation'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.get.query).toHaveBeenCalledWith({
			agentType: 'implementation',
		});
	});

	it('outputs JSON with agentType and triggers array when --json flag is set', async () => {
		const client = makeClient();
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsTriggers(['implementation', '--json'], oclifConfig as never);
		await cmd.run();

		expect(client.agentDefinitions.get.query).toHaveBeenCalledWith({
			agentType: 'implementation',
		});
	});

	it('handles empty triggers array gracefully', async () => {
		const client = makeClient();
		(client.agentDefinitions.get.query as ReturnType<typeof vi.fn>).mockResolvedValue({
			...sampleDefinitionRow,
			definition: { ...sampleDefinition, triggers: [] },
		});
		mockCreateDashboardClient.mockReturnValue(client);

		const cmd = new DefinitionsTriggers(['implementation'], oclifConfig as never);
		await expect(cmd.run()).resolves.toBeUndefined();
	});

	it('requires agentType argument', async () => {
		mockCreateDashboardClient.mockReturnValue(makeClient());

		const cmd = new DefinitionsTriggers([], oclifConfig as never);
		await expect(cmd.run()).rejects.toThrow();
	});
});

/**
 * Tests for the factory functions: createGadgetClass, createCLICommand, generateToolManifest
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const { mockReadFileSync, mockExecFileSync } = vi.hoisted(() => ({
	mockReadFileSync: vi.fn(),
	mockExecFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
	readFileSync: mockReadFileSync,
}));

vi.mock('node:child_process', () => ({
	execFileSync: mockExecFileSync,
}));

// Mock all credential/provider modules that CredentialScopedCommand loads
vi.mock('../../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token: string, fn: () => Promise<void>) => fn()),
}));
vi.mock('../../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn((_creds: unknown, fn: () => Promise<void>) => fn()),
}));
vi.mock('../../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn((_creds: unknown, fn: () => Promise<void>) => fn()),
}));
vi.mock('../../../../src/pm/index.js', () => ({
	createPMProvider: vi.fn(() => ({})),
	withPMProvider: vi.fn((_provider: unknown, fn: () => Promise<void>) => fn()),
}));

import {
	type CLICoreFn,
	createCLICommand,
} from '../../../../src/gadgets/shared/cliCommandFactory.js';
import {
	type GadgetCoreFn,
	buildZodSchema,
	createGadgetClass,
} from '../../../../src/gadgets/shared/gadgetFactory.js';
import { generateToolManifest } from '../../../../src/gadgets/shared/manifestGenerator.js';
import type { ToolDefinition } from '../../../../src/gadgets/shared/toolDefinition.js';

// ---------------------------------------------------------------------------
// Shared test definitions
// ---------------------------------------------------------------------------

/** Simple tool with basic string/number/boolean params */
const simpleToolDef: ToolDefinition = {
	name: 'SimpleTool',
	description: 'A simple tool for testing',
	timeoutMs: 5000,
	parameters: {
		comment: { type: 'string', describe: 'Brief rationale', gadgetOnly: true },
		name: { type: 'string', describe: 'The name', required: true },
		count: { type: 'number', describe: 'The count', optional: true },
		active: { type: 'boolean', describe: 'Is active', optional: true, default: false },
	},
	examples: [
		{
			params: { comment: 'test', name: 'Alice', count: 5 },
			output: 'Hello Alice',
			comment: 'Basic usage',
		},
	],
};

/** Tool with file-input alternatives */
const fileInputToolDef: ToolDefinition = {
	name: 'PostComment',
	description: 'Post a comment to a work item.',
	timeoutMs: 30000,
	parameters: {
		comment: { type: 'string', describe: 'Brief rationale', gadgetOnly: true },
		workItemId: { type: 'string', describe: 'The work item ID', required: true },
		text: { type: 'string', describe: 'The comment text', required: true },
	},
	cli: {
		fileInputAlternatives: [
			{
				paramName: 'text',
				fileFlag: 'text-file',
				description: 'Read comment text from file (use - for stdin)',
			},
		],
	},
};

/** Tool with auto-resolved owner/repo params */
const autoResolveToolDef: ToolDefinition = {
	name: 'GetPRDetails',
	description: 'Get details about a pull request.',
	timeoutMs: 30000,
	parameters: {
		owner: {
			type: 'string',
			describe: 'Repository owner (auto-detected)',
			optional: true,
			cliEnvVar: 'CASCADE_REPO_OWNER',
		},
		repo: {
			type: 'string',
			describe: 'Repository name (auto-detected)',
			optional: true,
			cliEnvVar: 'CASCADE_REPO_NAME',
		},
		prNumber: { type: 'number', describe: 'Pull request number', required: true },
	},
	cli: {
		autoResolved: [
			{ paramName: 'owner', envVar: 'CASCADE_REPO_OWNER', resolvedFrom: 'git-remote' },
			{ paramName: 'repo', envVar: 'CASCADE_REPO_NAME', resolvedFrom: 'git-remote' },
		],
	},
};

/** Tool with enum parameter */
const enumToolDef: ToolDefinition = {
	name: 'SetStatus',
	description: 'Set status of an item.',
	parameters: {
		status: {
			type: 'enum',
			describe: 'The new status',
			options: ['pending', 'active', 'done'],
			required: true,
		},
	},
};

/** Tool with array parameter */
const arrayToolDef: ToolDefinition = {
	name: 'AddItems',
	description: 'Add items to a list.',
	parameters: {
		items: {
			type: 'array',
			describe: 'Items to add',
			items: 'string',
			required: true,
		},
	},
};

/** Tool with object parameter */
const objectToolDef: ToolDefinition = {
	name: 'UpdateConfig',
	description: 'Update configuration.',
	parameters: {
		config: {
			type: 'object',
			describe: 'Configuration object as JSON',
			required: true,
		},
	},
};

/** Tool with number constraints */
const numericToolDef: ToolDefinition = {
	name: 'SetTimeout',
	description: 'Set a timeout value.',
	parameters: {
		ms: {
			type: 'number',
			describe: 'Timeout in milliseconds',
			required: true,
			min: 100,
			max: 60000,
		},
	},
};

// ---------------------------------------------------------------------------
// buildZodSchema tests
// ---------------------------------------------------------------------------

describe('buildZodSchema', () => {
	it('creates a schema with all parameter types', () => {
		const schema = buildZodSchema({
			str: { type: 'string', describe: 'A string', required: true },
			num: { type: 'number', describe: 'A number', required: true },
			bool: { type: 'boolean', describe: 'A boolean', optional: true },
		});

		// Schema should parse valid data
		const result = schema.parse({ str: 'hello', num: 42, bool: true });
		expect(result).toEqual({ str: 'hello', num: 42, bool: true });
	});

	it('includes gadgetOnly params in the schema', () => {
		const schema = buildZodSchema({
			comment: { type: 'string', describe: 'Rationale', gadgetOnly: true },
			value: { type: 'string', describe: 'A value', required: true },
		});

		const result = schema.parse({ comment: 'test rationale', value: 'hello' });
		expect(result.comment).toBe('test rationale');
		expect(result.value).toBe('hello');
	});

	it('handles optional string params', () => {
		const schema = buildZodSchema({
			name: { type: 'string', describe: 'Name', optional: true },
		});

		// Optional param can be omitted
		const result = schema.parse({});
		expect(result.name).toBeUndefined();
	});

	it('applies default values', () => {
		const schema = buildZodSchema({
			active: { type: 'boolean', describe: 'Active', default: true },
		});

		const result = schema.parse({});
		expect(result.active).toBe(true);
	});

	it('handles enum params', () => {
		const schema = buildZodSchema(enumToolDef.parameters);

		const result = schema.parse({ status: 'active' });
		expect(result.status).toBe('active');

		// Invalid enum value should fail
		expect(() => schema.parse({ status: 'invalid' })).toThrow();
	});

	it('handles array params', () => {
		const schema = buildZodSchema(arrayToolDef.parameters);

		const result = schema.parse({ items: ['a', 'b', 'c'] });
		expect(result.items).toEqual(['a', 'b', 'c']);
	});

	it('handles object params', () => {
		const schema = buildZodSchema(objectToolDef.parameters);

		const result = schema.parse({ config: { key: 'value', nested: { x: 1 } } });
		expect(result.config).toEqual({ key: 'value', nested: { x: 1 } });
	});

	it('applies number min/max constraints', () => {
		const schema = buildZodSchema(numericToolDef.parameters);

		// Valid number
		expect(schema.parse({ ms: 1000 }).ms).toBe(1000);

		// Too small
		expect(() => schema.parse({ ms: 50 })).toThrow();

		// Too large
		expect(() => schema.parse({ ms: 100000 })).toThrow();
	});
});

// ---------------------------------------------------------------------------
// createGadgetClass tests
// ---------------------------------------------------------------------------

describe('createGadgetClass', () => {
	it('creates a class that can be instantiated', () => {
		const coreFn: GadgetCoreFn = async () => 'result';
		const GadgetClass = createGadgetClass(simpleToolDef, coreFn);

		const instance = new GadgetClass();
		expect(instance).toBeDefined();
	});

	it('the generated class has the correct name and description', () => {
		const coreFn: GadgetCoreFn = async () => 'result';
		const GadgetClass = createGadgetClass(simpleToolDef, coreFn);

		const instance = new GadgetClass();
		// The name comes from the Gadget config name override
		// Access via the instance's description property
		expect(instance.description).toBe('A simple tool for testing');
	});

	it('execute calls the coreFn with params', async () => {
		const coreFn = vi.fn().mockResolvedValue('Hello Alice');
		const GadgetClass = createGadgetClass(simpleToolDef, coreFn);

		const instance = new GadgetClass();
		const result = await instance.execute({ name: 'Alice', count: 5, comment: 'test' });

		expect(coreFn).toHaveBeenCalledWith({ name: 'Alice', count: 5, comment: 'test' });
		expect(result).toBe('Hello Alice');
	});

	it('applies gadgetPostExecute hook when defined', async () => {
		const coreFn = vi.fn().mockResolvedValue('original output');
		const postExecute = vi.fn().mockResolvedValue('transformed output');

		const defWithHook: ToolDefinition = {
			...simpleToolDef,
			gadgetPostExecute: postExecute,
		};

		const GadgetClass = createGadgetClass(defWithHook, coreFn);
		const instance = new GadgetClass();
		const result = await instance.execute({ name: 'test', comment: 'test' });

		expect(coreFn).toHaveBeenCalled();
		expect(postExecute).toHaveBeenCalledWith('original output', { name: 'test', comment: 'test' });
		expect(result).toBe('transformed output');
	});

	it('returns original output when gadgetPostExecute hook returns undefined', async () => {
		const coreFn = vi.fn().mockResolvedValue('original output');
		const postExecute = vi.fn().mockResolvedValue(undefined);

		const defWithHook: ToolDefinition = {
			...simpleToolDef,
			gadgetPostExecute: postExecute,
		};

		const GadgetClass = createGadgetClass(defWithHook, coreFn);
		const instance = new GadgetClass();
		const result = await instance.execute({ name: 'test', comment: 'test' });

		expect(result).toBe('original output');
	});

	it('skips gadgetPostExecute when not defined', async () => {
		const coreFn = vi.fn().mockResolvedValue('output');
		const GadgetClass = createGadgetClass(simpleToolDef, coreFn);

		const instance = new GadgetClass();
		const result = await instance.execute({ name: 'test', comment: 'test' });

		expect(result).toBe('output');
	});

	it('schema includes gadgetOnly params (like comment)', () => {
		const coreFn: GadgetCoreFn = async () => 'ok';
		const GadgetClass = createGadgetClass(simpleToolDef, coreFn);

		const instance = new GadgetClass();
		// parameterSchema should exist and include comment
		expect(instance.parameterSchema).toBeDefined();
		const parsed = instance.parameterSchema.parse({ comment: 'rationale', name: 'test' });
		expect(parsed.comment).toBe('rationale');
	});

	it('has the configured timeoutMs', () => {
		const coreFn: GadgetCoreFn = async () => 'ok';
		const GadgetClass = createGadgetClass(simpleToolDef, coreFn);

		const instance = new GadgetClass();
		expect(instance.timeoutMs).toBe(5000);
	});

	it('has examples from the definition', () => {
		const coreFn: GadgetCoreFn = async () => 'ok';
		const GadgetClass = createGadgetClass(simpleToolDef, coreFn);

		const instance = new GadgetClass();
		expect(instance.examples).toHaveLength(1);
		expect(instance.examples?.[0]?.comment).toBe('Basic usage');
	});

	it('handles definition with no examples', () => {
		const coreFn: GadgetCoreFn = async () => 'ok';
		const noExamplesDef: ToolDefinition = {
			name: 'NoExamples',
			description: 'No examples tool',
			parameters: { value: { type: 'string', describe: 'A value', required: true } },
		};

		const GadgetClass = createGadgetClass(noExamplesDef, coreFn);
		const instance = new GadgetClass();
		// examples should be undefined or empty
		expect(instance.examples === undefined || instance.examples?.length === 0).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// createCLICommand tests
// ---------------------------------------------------------------------------

describe('createCLICommand', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('creates a class with correct static description', () => {
		const coreFn: CLICoreFn = async () => ({ id: '123' });
		const CommandClass = createCLICommand(simpleToolDef, coreFn);

		expect(CommandClass.description).toBe('A simple tool for testing');
	});

	it('generates flags from non-gadgetOnly parameters', () => {
		const coreFn: CLICoreFn = async () => 'result';
		const CommandClass = createCLICommand(simpleToolDef, coreFn);

		const flags = CommandClass.flags;
		// 'name', 'count', 'active' should be present (not 'comment' which is gadgetOnly)
		expect(flags.name).toBeDefined();
		expect(flags.count).toBeDefined();
		expect(flags.active).toBeDefined();
		expect(flags.comment).toBeUndefined();
	});

	it('generates file-input alternative flags', () => {
		const coreFn: CLICoreFn = async () => 'result';
		const CommandClass = createCLICommand(fileInputToolDef, coreFn);

		const flags = CommandClass.flags;
		// Both 'text' and 'text-file' should be present
		expect(flags.text).toBeDefined();
		expect(flags['text-file']).toBeDefined();
		// 'comment' should NOT be present (gadgetOnly)
		expect(flags.comment).toBeUndefined();
	});

	it('makes file-input params optional when they have a file alternative', () => {
		const coreFn: CLICoreFn = async () => 'result';
		const CommandClass = createCLICommand(fileInputToolDef, coreFn);

		const flags = CommandClass.flags;
		// 'text' is required in params but optional in CLI because --text-file is available
		expect(flags.text?.required).toBeFalsy();
	});

	it('generates auto-resolved owner/repo flags as optional', () => {
		const coreFn: CLICoreFn = async () => 'result';
		const CommandClass = createCLICommand(autoResolveToolDef, coreFn);

		const flags = CommandClass.flags;
		// owner and repo should exist as optional flags
		expect(flags.owner).toBeDefined();
		expect(flags.repo).toBeDefined();
		expect(flags.owner?.required).toBeFalsy();
		expect(flags.repo?.required).toBeFalsy();
	});

	it('resolves owner/repo from env vars when not provided as flags', async () => {
		vi.stubEnv('CASCADE_REPO_OWNER', 'myorg');
		vi.stubEnv('CASCADE_REPO_NAME', 'myrepo');

		let capturedParams: Record<string, unknown> = {};
		const coreFn: CLICoreFn = async (params) => {
			capturedParams = params as Record<string, unknown>;
			return { success: true };
		};

		const CommandClass = createCLICommand(autoResolveToolDef, coreFn);
		const instance = new CommandClass([], {});

		// Simulate flags - prNumber is required, owner/repo not provided (will be auto-resolved)
		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { prNumber: 42, owner: undefined, repo: undefined },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		const logSpy = vi.spyOn(instance, 'log').mockImplementation(() => {});

		await instance.execute();

		expect(capturedParams.owner).toBe('myorg');
		expect(capturedParams.repo).toBe('myrepo');
		expect(capturedParams.prNumber).toBe(42);
		expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ success: true, data: { success: true } }));
	});

	it('resolves owner/repo from git remote when env vars are not set', async () => {
		// Ensure env vars are not set so git remote detection kicks in
		vi.stubEnv('CASCADE_REPO_OWNER', '');
		vi.stubEnv('CASCADE_REPO_NAME', '');

		// Configure mock before using it
		mockExecFileSync.mockReturnValue('git@github.com:myorg/myrepo.git\n');

		let capturedParams: Record<string, unknown> = {};
		const coreFn: CLICoreFn = async (params) => {
			capturedParams = params as Record<string, unknown>;
			return { success: true };
		};

		const CommandClass = createCLICommand(autoResolveToolDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { prNumber: 42, owner: undefined, repo: undefined },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		vi.spyOn(instance, 'log').mockImplementation(() => {});

		await instance.execute();

		// Should have resolved from git remote mock
		expect(capturedParams.owner).toBe('myorg');
		expect(capturedParams.repo).toBe('myrepo');
	});

	it('reads text from file when --text-file is provided', async () => {
		mockReadFileSync.mockReturnValue('Content from file');

		let capturedParams: Record<string, unknown> = {};
		const coreFn: CLICoreFn = async (params) => {
			capturedParams = params as Record<string, unknown>;
			return 'comment posted';
		};

		const CommandClass = createCLICommand(fileInputToolDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { workItemId: 'card123', 'text-file': '/path/to/file.txt', text: undefined },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		vi.spyOn(instance, 'log').mockImplementation(() => {});

		await instance.execute();

		expect(mockReadFileSync).toHaveBeenCalledWith('/path/to/file.txt', 'utf-8');
		expect(capturedParams.text).toBe('Content from file');
		expect(capturedParams.workItemId).toBe('card123');
	});

	it('reads text from stdin when --text-file is -', async () => {
		mockReadFileSync.mockReturnValue('Content from stdin');

		let capturedParams: Record<string, unknown> = {};
		const coreFn: CLICoreFn = async (params) => {
			capturedParams = params as Record<string, unknown>;
			return 'posted';
		};

		const CommandClass = createCLICommand(fileInputToolDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { workItemId: 'card123', 'text-file': '-', text: undefined },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		vi.spyOn(instance, 'log').mockImplementation(() => {});

		await instance.execute();

		// stdin is fd 0
		expect(mockReadFileSync).toHaveBeenCalledWith(0, 'utf-8');
		expect(capturedParams.text).toBe('Content from stdin');
	});

	it('errors when file-input required param is missing', async () => {
		const coreFn: CLICoreFn = async () => 'result';
		const CommandClass = createCLICommand(fileInputToolDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { workItemId: 'card123', text: undefined, 'text-file': undefined },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		const errorSpy = vi.spyOn(instance, 'error').mockImplementation((msg: string | Error) => {
			throw new Error(typeof msg === 'string' ? msg : msg.message);
		});

		await expect(instance.execute()).rejects.toThrow('Either --text or --text-file is required');
		expect(errorSpy).toHaveBeenCalled();
	});

	it('outputs JSON result on success', async () => {
		const coreFn: CLICoreFn = async () => ({ id: '456', url: 'https://example.com' });
		const CommandClass = createCLICommand(simpleToolDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { name: 'Alice', count: undefined, active: false },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		const logSpy = vi.spyOn(instance, 'log').mockImplementation(() => {});

		await instance.execute();

		expect(logSpy).toHaveBeenCalledWith(
			JSON.stringify({ success: true, data: { id: '456', url: 'https://example.com' } }),
		);
	});

	it('parses JSON for object type params', async () => {
		let capturedParams: Record<string, unknown> = {};
		const coreFn: CLICoreFn = async (params) => {
			capturedParams = params as Record<string, unknown>;
			return 'updated';
		};

		const CommandClass = createCLICommand(objectToolDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { config: '{"key":"value","count":5}' },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		vi.spyOn(instance, 'log').mockImplementation(() => {});

		await instance.execute();

		expect(capturedParams.config).toEqual({ key: 'value', count: 5 });
	});

	it('errors on invalid JSON for object type params', async () => {
		const coreFn: CLICoreFn = async () => 'result';
		const CommandClass = createCLICommand(objectToolDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { config: '{not-valid-json}' },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		vi.spyOn(instance, 'error').mockImplementation((msg: string | Error) => {
			throw new Error(typeof msg === 'string' ? msg : msg.message);
		});

		await expect(instance.execute()).rejects.toThrow('--config must be valid JSON');
	});

	it('calls post-execute hook when defined', async () => {
		const postExecute = vi.fn();
		const coreFn: CLICoreFn = async () => ({ prUrl: 'https://github.com/pr/1' });

		const defWithHook: ToolDefinition = {
			...simpleToolDef,
			cli: {
				postExecute,
			},
		};

		const CommandClass = createCLICommand(defWithHook, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { name: 'test' },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		vi.spyOn(instance, 'log').mockImplementation(() => {});

		await instance.execute();

		expect(postExecute).toHaveBeenCalledWith(
			{ prUrl: 'https://github.com/pr/1' },
			{ name: 'test' },
		);
	});

	it('skips gadgetOnly params in flag processing', async () => {
		let capturedParams: Record<string, unknown> = {};
		const coreFn: CLICoreFn = async (params) => {
			capturedParams = params as Record<string, unknown>;
			return 'ok';
		};

		const CommandClass = createCLICommand(simpleToolDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { name: 'Alice' },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		vi.spyOn(instance, 'log').mockImplementation(() => {});

		await instance.execute();

		// 'comment' (gadgetOnly) should NOT be in capturedParams
		expect(capturedParams).not.toHaveProperty('comment');
		expect(capturedParams.name).toBe('Alice');
	});

	it('passes array flags through correctly', async () => {
		let capturedParams: Record<string, unknown> = {};
		const coreFn: CLICoreFn = async (params) => {
			capturedParams = params as Record<string, unknown>;
			return 'added';
		};

		const CommandClass = createCLICommand(arrayToolDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { items: ['item1', 'item2', 'item3'] },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		vi.spyOn(instance, 'log').mockImplementation(() => {});

		await instance.execute();

		expect(capturedParams.items).toEqual(['item1', 'item2', 'item3']);
	});
});

// ---------------------------------------------------------------------------
// generateToolManifest tests
// ---------------------------------------------------------------------------

describe('generateToolManifest', () => {
	it('generates manifest with correct name and description', () => {
		const manifest = generateToolManifest(simpleToolDef, 'cascade-tools pm simple-tool');

		expect(manifest.name).toBe('SimpleTool');
		expect(manifest.description).toBe('A simple tool for testing');
	});

	it('uses provided cliCommandOverride', () => {
		const manifest = generateToolManifest(simpleToolDef, 'cascade-tools pm simple-tool');

		expect(manifest.cliCommand).toBe('cascade-tools pm simple-tool');
	});

	it('excludes gadgetOnly params from manifest', () => {
		const manifest = generateToolManifest(simpleToolDef, 'cascade-tools pm simple-tool');

		// 'comment' is gadgetOnly and should NOT be in parameters
		expect(manifest.parameters.comment).toBeUndefined();
	});

	it('includes non-gadgetOnly params in manifest', () => {
		const manifest = generateToolManifest(simpleToolDef, 'cascade-tools pm simple-tool');

		expect(manifest.parameters.name).toBeDefined();
		expect(manifest.parameters.count).toBeDefined();
		expect(manifest.parameters.active).toBeDefined();
	});

	it('marks required params as required in manifest', () => {
		const manifest = generateToolManifest(simpleToolDef, 'cascade-tools pm simple-tool');

		const nameParam = manifest.parameters.name as { type: string; required?: boolean };
		expect(nameParam.required).toBe(true);
	});

	it('does not mark optional params as required', () => {
		const manifest = generateToolManifest(simpleToolDef, 'cascade-tools pm simple-tool');

		const countParam = manifest.parameters.count as { type: string; required?: boolean };
		expect(countParam.required).toBeFalsy();
	});

	it('includes file-input alternative flags in manifest', () => {
		const manifest = generateToolManifest(fileInputToolDef, 'cascade-tools pm post-comment');

		// Both 'text' and 'text-file' should appear
		expect(manifest.parameters.text).toBeDefined();
		expect(manifest.parameters['text-file']).toBeDefined();
		// 'comment' should NOT appear (gadgetOnly)
		expect(manifest.parameters.comment).toBeUndefined();
	});

	it('file-input flag description uses the provided description', () => {
		const manifest = generateToolManifest(fileInputToolDef, 'cascade-tools pm post-comment');

		const textFileParam = manifest.parameters['text-file'] as { type: string; description: string };
		expect(textFileParam.description).toBe('Read comment text from file (use - for stdin)');
	});

	it('file-input flag description defaults to standard format', () => {
		const defWithDefaultFileDesc: ToolDefinition = {
			...fileInputToolDef,
			cli: {
				fileInputAlternatives: [{ paramName: 'text', fileFlag: 'text-file' }],
			},
		};

		const manifest = generateToolManifest(defWithDefaultFileDesc, 'cascade-tools pm post-comment');

		const textFileParam = manifest.parameters['text-file'] as { type: string; description: string };
		expect(textFileParam.description).toContain('text');
	});

	it('enum params get correct type and options', () => {
		const manifest = generateToolManifest(enumToolDef, 'cascade-tools pm set-status');

		const statusParam = manifest.parameters.status as {
			type: string;
			options?: string[];
			required?: boolean;
		};
		expect(statusParam.type).toBe('string');
		expect(statusParam.options).toEqual(['pending', 'active', 'done']);
		expect(statusParam.required).toBe(true);
	});

	it('array params have type "array"', () => {
		const manifest = generateToolManifest(arrayToolDef, 'cascade-tools pm add-items');

		const itemsParam = manifest.parameters.items as { type: string; required?: boolean };
		expect(itemsParam.type).toBe('array');
		expect(itemsParam.required).toBe(true);
	});

	it('object params have type "object"', () => {
		const manifest = generateToolManifest(objectToolDef, 'cascade-tools pm update-config');

		const configParam = manifest.parameters.config as { type: string; required?: boolean };
		expect(configParam.type).toBe('object');
		expect(configParam.required).toBe(true);
	});

	it('derives CLI command for PM tools automatically', () => {
		const manifest = generateToolManifest(fileInputToolDef);

		// PostComment should be classified as a PM tool
		expect(manifest.cliCommand).toBe('cascade-tools pm post-comment');
	});

	it('derives CLI command for SCM tools automatically', () => {
		const manifest = generateToolManifest(autoResolveToolDef);

		// GetPRDetails should be classified as an SCM tool
		expect(manifest.cliCommand).toBe('cascade-tools scm get-pr-details');
	});

	it('strips PM prefix from tool names to avoid double pm prefix', () => {
		const pmPrefixedToolDef: ToolDefinition = {
			name: 'PMUpdateChecklistItem',
			description: 'Update a checklist item',
			parameters: {
				itemId: { type: 'string', describe: 'Item ID', required: true },
			},
		};

		const manifest = generateToolManifest(pmPrefixedToolDef);

		// Should be "cascade-tools pm update-checklist-item", not "cascade-tools pm pm-update-checklist-item"
		expect(manifest.cliCommand).toBe('cascade-tools pm update-checklist-item');
	});

	it('returns a ToolManifest with required fields', () => {
		const manifest = generateToolManifest(simpleToolDef, 'cascade-tools pm simple-tool');

		expect(manifest).toHaveProperty('name');
		expect(manifest).toHaveProperty('description');
		expect(manifest).toHaveProperty('cliCommand');
		expect(manifest).toHaveProperty('parameters');
	});
});

// ---------------------------------------------------------------------------
// Round-trip consistency tests
// ---------------------------------------------------------------------------

describe('round-trip consistency', () => {
	it('same ToolDefinition produces consistent Zod schema and manifest', () => {
		const def: ToolDefinition = {
			name: 'PostComment',
			description: 'Post a comment',
			parameters: {
				comment: { type: 'string', describe: 'Rationale', gadgetOnly: true },
				workItemId: { type: 'string', describe: 'Work item ID', required: true },
				text: { type: 'string', describe: 'Comment text', required: true },
			},
			cli: {
				fileInputAlternatives: [{ paramName: 'text', fileFlag: 'text-file' }],
			},
		};

		// Gadget schema includes gadgetOnly params
		const schema = buildZodSchema(def.parameters);
		const parsed = schema.parse({ comment: 'test', workItemId: 'abc', text: 'hello' });
		expect(parsed.comment).toBe('test'); // gadgetOnly included in schema

		// Manifest excludes gadgetOnly params
		const manifest = generateToolManifest(def, 'cascade-tools pm post-comment');
		expect(manifest.parameters.comment).toBeUndefined(); // excluded from manifest
		expect(manifest.parameters.workItemId).toBeDefined();
		expect(manifest.parameters.text).toBeDefined();
		expect(manifest.parameters['text-file']).toBeDefined(); // file-input alt included

		// CLI command excludes gadgetOnly params from flags
		const CommandClass = createCLICommand(def, async () => 'ok');
		expect(CommandClass.flags.comment).toBeUndefined(); // excluded from CLI
		expect(CommandClass.flags.workItemId).toBeDefined();
		expect(CommandClass.flags.text).toBeDefined();
		expect(CommandClass.flags['text-file']).toBeDefined();
	});

	it('all three factories use same definition without cross-contamination', () => {
		// createGadgetClass, createCLICommand, generateToolManifest can be called
		// on the same def without modifying it
		const def: ToolDefinition = {
			name: 'TestTool',
			description: 'A test tool',
			parameters: {
				comment: { type: 'string', describe: 'Rationale', gadgetOnly: true },
				value: { type: 'string', describe: 'Value', required: true },
			},
		};

		const originalDef = JSON.parse(JSON.stringify(def)) as ToolDefinition;

		const GadgetClass = createGadgetClass(def, async () => 'ok');
		const CommandClass = createCLICommand(def, async () => 'ok');
		const manifest = generateToolManifest(def, 'cascade-tools pm test-tool');

		// Verify def is unchanged
		expect(def.name).toBe(originalDef.name);
		expect(def.parameters).toEqual(originalDef.parameters);

		// All three should be usable
		expect(GadgetClass).toBeDefined();
		expect(CommandClass).toBeDefined();
		expect(manifest.name).toBe('TestTool');
	});
});

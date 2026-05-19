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
	buildZodSchema,
	createGadgetClass,
	type GadgetCoreFn,
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

	it('filters examples that use CLI-only params out of SDK gadget examples', () => {
		const coreFn: GadgetCoreFn = async () => 'ok';
		const def: ToolDefinition = {
			name: 'CliOnlyExampleTool',
			description: 'A tool with a CLI-only example',
			parameters: {
				value: { type: 'string', describe: 'A value', required: true },
				outputFile: {
					type: 'string',
					describe: 'Write output to a file',
					optional: true,
					cliOnly: true,
				},
			},
			examples: [
				{
					params: { value: 'visible' },
					comment: 'SDK-safe example',
				},
				{
					params: { value: 'cli', outputFile: '/tmp/out.txt' },
					comment: 'CLI-only example',
				},
			],
		};
		const GadgetClass = createGadgetClass(def, coreFn);

		const instance = new GadgetClass();
		expect(instance.examples).toHaveLength(1);
		expect(instance.examples?.[0]?.params).toEqual({ value: 'visible' });
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

	// Legacy test removed — replaced by spec-014 envelope assertion in
	// 'missing file-input required param routes through envelope (type:"missing-required")' below.

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

	// Legacy test removed — replaced by spec-014 envelope assertion in
	// 'object param with malformed JSON routes through envelope (type:"json-parse")' below.

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

	// Legacy test removed — replaced by spec-014 envelope assertion in
	// 'coreFn runtime failure routes through the new envelope (type:"runtime")' below.

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
// Spec 014: cliCommandFactory widened behavior (aliases, JSON-parse for
// array-of-object, help examples, structured error envelope).
// ---------------------------------------------------------------------------

describe('createCLICommand — spec 014 additions', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// Test def: single array-of-object param with an alias and a file alternative.
	const reviewPRDef: ToolDefinition = {
		name: 'TestReviewPR',
		description: 'Submit a PR review (test fixture).',
		parameters: {
			body: { type: 'string', describe: 'Review body', required: true },
			comments: {
				type: 'array',
				items: 'object',
				describe: 'Inline comments',
				cliAliases: ['comment'],
				optional: true,
			},
		},
		examples: [
			{
				params: {
					body: 'LGTM',
					comments: [{ path: 'src/x.ts', line: 1, body: 'nit' }],
				},
				comment: 'Request changes with inline',
			},
		],
		cli: {
			fileInputAlternatives: [
				{
					paramName: 'comments',
					fileFlag: 'comments-file',
					parseAs: 'json',
					description: 'Read --comments JSON from file (use - for stdin).',
				},
			],
		},
	};

	it('applies cliAliases onto the generated oclif flag', () => {
		const coreFn: CLICoreFn = async () => 'ok';
		const CommandClass = createCLICommand(reviewPRDef, coreFn);

		const commentsFlag = CommandClass.flags.comments as { aliases?: string[] };
		expect(commentsFlag.aliases).toEqual(['comment']);
	});

	it('wires def.examples onto FactoryCommand.examples for oclif --help', () => {
		const coreFn: CLICoreFn = async () => 'ok';
		const CommandClass = createCLICommand(reviewPRDef, coreFn);

		const examples = CommandClass.examples as string[] | undefined;
		expect(examples).toBeDefined();
		expect(examples?.length ?? 0).toBeGreaterThan(0);
		// The JSON shape from the example should appear — serialized double-quoted.
		expect(examples?.[0]).toContain('"path":"src/x.ts"');
	});

	it('array + items:"object" flag value parses as JSON (single string, not repeatable)', async () => {
		let capturedParams: Record<string, unknown> = {};
		const coreFn: CLICoreFn = async (params) => {
			capturedParams = params as Record<string, unknown>;
			return 'ok';
		};

		const CommandClass = createCLICommand(reviewPRDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: {
				body: 'LGTM',
				comments: '[{"path":"a","line":1,"body":"b"}]',
			},
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		vi.spyOn(instance, 'log').mockImplementation(() => {});

		await instance.execute();

		expect(capturedParams.comments).toEqual([{ path: 'a', line: 1, body: 'b' }]);
	});

	it('array + items:"object" with malformed JSON emits json-parse envelope on stdout', async () => {
		const coreFn: CLICoreFn = async () => 'ok';
		const CommandClass = createCLICommand(reviewPRDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: {
				body: 'LGTM',
				comments: "[{'path':'a','line':1,'body':'b'}]", // single-quoted keys — bug from prod run 5d993b04
			},
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		const logSpy = vi.spyOn(instance, 'log').mockImplementation(() => {});
		vi.spyOn(instance, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});

		await expect(instance.execute()).rejects.toThrow('exit');

		// The new envelope must surface on this.log (stdout)
		const logged = logSpy.mock.calls.map((c) => c[0]).join('\n');
		const jsonLine = logged.split('\n').find((l) => l.startsWith('{')) ?? '';
		const parsed = JSON.parse(jsonLine) as {
			success: boolean;
			error: {
				type: string;
				flag?: string;
				got?: string;
				expected?: string;
				hint?: string;
			};
		};
		expect(parsed.success).toBe(false);
		expect(parsed.error.type).toBe('json-parse');
		expect(parsed.error.flag).toBe('comments');
		expect(parsed.error.got).toContain("[{'path'");
		expect(parsed.error.expected).toContain('"path"');
		expect(parsed.error.hint).toContain('--comments-file');
	});

	it('file-input with parseAs:"json" JSON-parses the file contents', async () => {
		mockReadFileSync.mockReturnValue('[{"path":"a","line":1,"body":"b"}]');

		let capturedParams: Record<string, unknown> = {};
		const coreFn: CLICoreFn = async (params) => {
			capturedParams = params as Record<string, unknown>;
			return 'ok';
		};

		const CommandClass = createCLICommand(reviewPRDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: {
				body: 'LGTM',
				'comments-file': '/tmp/comments.json',
				comments: undefined,
			},
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		vi.spyOn(instance, 'log').mockImplementation(() => {});

		await instance.execute();

		expect(capturedParams.comments).toEqual([{ path: 'a', line: 1, body: 'b' }]);
	});

	it('file-input with parseAs:"json" malformed contents emits json-parse envelope', async () => {
		mockReadFileSync.mockReturnValue("[{'path':'a'}]");

		const coreFn: CLICoreFn = async () => 'ok';
		const CommandClass = createCLICommand(reviewPRDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: {
				body: 'LGTM',
				'comments-file': '/tmp/comments.json',
				comments: undefined,
			},
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		const logSpy = vi.spyOn(instance, 'log').mockImplementation(() => {});
		vi.spyOn(instance, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});

		await expect(instance.execute()).rejects.toThrow('exit');

		const logged = logSpy.mock.calls.map((c) => c[0]).join('\n');
		const jsonLine = logged.split('\n').find((l) => l.startsWith('{')) ?? '';
		const parsed = JSON.parse(jsonLine) as {
			success: boolean;
			error: { type: string; flag?: string };
		};
		expect(parsed.error.type).toBe('json-parse');
		expect(parsed.error.flag).toBe('comments');
	});

	it('coreFn runtime failure routes through the new envelope (type:"runtime")', async () => {
		const failingFn: CLICoreFn = async () => {
			throw new Error('getaddrinfo EAI_AGAIN api.trello.com');
		};
		const CommandClass = createCLICommand(simpleToolDef, failingFn);
		const instance = new CommandClass([], {});
		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { name: 'Alice' },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);
		const logSpy = vi.spyOn(instance, 'log').mockImplementation(() => {});
		vi.spyOn(instance, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});

		await expect(instance.execute()).rejects.toThrow('exit');
		const logged = logSpy.mock.calls.map((c) => c[0]).join('\n');
		const jsonLine = logged.split('\n').find((l) => l.startsWith('{')) ?? '';
		const parsed = JSON.parse(jsonLine) as {
			success: boolean;
			error: { type: string; message: string };
		};
		expect(parsed.success).toBe(false);
		expect(parsed.error.type).toBe('runtime');
		expect(parsed.error.message).toBe('getaddrinfo EAI_AGAIN api.trello.com');
	});

	it('missing file-input required param routes through envelope (type:"missing-required")', async () => {
		const coreFn: CLICoreFn = async () => 'result';
		const CommandClass = createCLICommand(fileInputToolDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { workItemId: 'card123', text: undefined, 'text-file': undefined },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		const logSpy = vi.spyOn(instance, 'log').mockImplementation(() => {});
		vi.spyOn(instance, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});

		await expect(instance.execute()).rejects.toThrow('exit');
		const logged = logSpy.mock.calls.map((c) => c[0]).join('\n');
		const jsonLine = logged.split('\n').find((l) => l.startsWith('{')) ?? '';
		const parsed = JSON.parse(jsonLine) as {
			success: boolean;
			error: { type: string; flag?: string };
		};
		expect(parsed.error.type).toBe('missing-required');
		expect(parsed.error.flag).toBe('text');
	});

	it('primitive-array (items:"string") still uses multiple:true (regression guard)', () => {
		// arrayToolDef has items:'string' → repeatable flag
		const coreFn: CLICoreFn = async () => 'ok';
		const CommandClass = createCLICommand(arrayToolDef, coreFn);
		const itemsFlag = CommandClass.flags.items as { multiple?: boolean };
		expect(itemsFlag.multiple).toBe(true);
	});

	it('unknown flag close to a declared one suggests correction via Levenshtein', async () => {
		const coreFn: CLICoreFn = async () => 'ok';
		const CommandClass = createCLICommand(reviewPRDef, coreFn);
		const instance = new CommandClass([], {});

		// Simulate oclif's NonExistentFlagsError shape (constructor name + flags array)
		class NonExistentFlagsError extends Error {
			public flags: string[];
			constructor(flags: string[]) {
				super(`Nonexistent flag: ${flags.join(', ')}`);
				this.name = 'CLIParseError';
				this.flags = flags;
			}
		}

		vi.spyOn(instance, 'parse').mockImplementation(async () => {
			throw new NonExistentFlagsError(['comnent']);
		});

		const logSpy = vi.spyOn(instance, 'log').mockImplementation(() => {});
		vi.spyOn(instance, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});

		await expect(instance.execute()).rejects.toThrow('exit');
		const logged = logSpy.mock.calls.map((c) => c[0]).join('\n');
		const jsonLine = logged.split('\n').find((l) => l.startsWith('{')) ?? '';
		const parsed = JSON.parse(jsonLine) as {
			error: { type: string; flag?: string; hint?: string };
		};
		expect(parsed.error.type).toBe('unknown-flag');
		expect(parsed.error.flag).toBe('comnent');
		expect(parsed.error.hint).toContain('did you mean');
		expect(parsed.error.hint).toContain('--comments');
	});

	it('unknown flag far from any declared one emits envelope without suggestion', async () => {
		const coreFn: CLICoreFn = async () => 'ok';
		const CommandClass = createCLICommand(reviewPRDef, coreFn);
		const instance = new CommandClass([], {});

		class NonExistentFlagsError extends Error {
			public flags: string[];
			constructor(flags: string[]) {
				super(`Nonexistent flag: ${flags.join(', ')}`);
				this.name = 'CLIParseError';
				this.flags = flags;
			}
		}

		vi.spyOn(instance, 'parse').mockImplementation(async () => {
			throw new NonExistentFlagsError(['zzzzzzzz']);
		});

		const logSpy = vi.spyOn(instance, 'log').mockImplementation(() => {});
		vi.spyOn(instance, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});

		await expect(instance.execute()).rejects.toThrow('exit');
		const logged = logSpy.mock.calls.map((c) => c[0]).join('\n');
		const jsonLine = logged.split('\n').find((l) => l.startsWith('{')) ?? '';
		const parsed = JSON.parse(jsonLine) as {
			error: { type: string; hint?: string };
		};
		expect(parsed.error.type).toBe('unknown-flag');
		// No "did you mean" when Levenshtein distance exceeds threshold
		expect(parsed.error.hint ?? '').not.toContain('did you mean');
	});

	it('fuzzy suggestion considers declared aliases but always returns the canonical name', async () => {
		const coreFn: CLICoreFn = async () => 'ok';
		const CommandClass = createCLICommand(reviewPRDef, coreFn);
		const instance = new CommandClass([], {});

		class NonExistentFlagsError extends Error {
			public flags: string[];
			constructor(flags: string[]) {
				super(`Nonexistent flag: ${flags.join(', ')}`);
				this.name = 'CLIParseError';
				this.flags = flags;
			}
		}

		// 'coment' is closer to the alias 'comment' than to the canonical 'comments'.
		// The suggestion must still surface the canonical spelling.
		vi.spyOn(instance, 'parse').mockImplementation(async () => {
			throw new NonExistentFlagsError(['coment']);
		});

		const logSpy = vi.spyOn(instance, 'log').mockImplementation(() => {});
		vi.spyOn(instance, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});

		await expect(instance.execute()).rejects.toThrow('exit');
		const logged = logSpy.mock.calls.map((c) => c[0]).join('\n');
		const jsonLine = logged.split('\n').find((l) => l.startsWith('{')) ?? '';
		const parsed = JSON.parse(jsonLine) as { error: { hint?: string } };
		expect(parsed.error.hint).toContain('--comments');
		expect(parsed.error.hint).not.toContain('--comment?');
	});

	it('object param with malformed JSON routes through envelope (type:"json-parse")', async () => {
		// This replaces the old 'errors on invalid JSON for object type params' assertion
		// which checked the legacy `--config must be valid JSON` prose error.
		const coreFn: CLICoreFn = async () => 'result';
		const CommandClass = createCLICommand(objectToolDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: { config: '{not-valid-json}' },
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		const logSpy = vi.spyOn(instance, 'log').mockImplementation(() => {});
		vi.spyOn(instance, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});

		await expect(instance.execute()).rejects.toThrow('exit');

		const logged = logSpy.mock.calls.map((c) => c[0]).join('\n');
		const jsonLine = logged.split('\n').find((l) => l.startsWith('{')) ?? '';
		const parsed = JSON.parse(jsonLine) as {
			success: boolean;
			error: { type: string; flag?: string };
		};
		expect(parsed.error.type).toBe('json-parse');
		expect(parsed.error.flag).toBe('config');
	});
});

// ---------------------------------------------------------------------------
// MNG-1059: multiple-stdin-consumer rejection at the factory level
// ---------------------------------------------------------------------------

describe('createCLICommand — multiple stdin consumer rejection (MNG-1059)', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const dualFileInputDef: ToolDefinition = {
		name: 'TestReviewWithBoth',
		description: 'Review a PR with both body and comments file inputs.',
		parameters: {
			body: { type: 'string', describe: 'Body', required: true },
			comments: {
				type: 'array',
				items: 'object',
				describe: 'Inline comments',
				optional: true,
			},
		},
		cli: {
			fileInputAlternatives: [
				{ paramName: 'body', fileFlag: 'body-file' },
				{
					paramName: 'comments',
					fileFlag: 'comments-file',
					parseAs: 'json',
				},
			],
		},
	};

	it('rejects --body-file - and --comments-file - with a flag-parse envelope', async () => {
		const coreFn = vi.fn();
		const CommandClass = createCLICommand(dualFileInputDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: {
				body: undefined,
				comments: undefined,
				'body-file': '-',
				'comments-file': '-',
			},
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		const logSpy = vi.spyOn(instance, 'log').mockImplementation(() => {});
		vi.spyOn(instance, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});

		await expect(instance.execute()).rejects.toThrow('exit');

		// Core function must NOT have been called — the guard runs before any
		// stdin read, so neither payload gets consumed (and corrupted).
		expect(coreFn).not.toHaveBeenCalled();

		const logged = logSpy.mock.calls.map((c) => c[0]).join('\n');
		const jsonLine = logged.split('\n').find((l) => l.startsWith('{')) ?? '';
		const parsed = JSON.parse(jsonLine) as {
			success: boolean;
			error: { type: string; flag?: string; message?: string; hint?: string };
		};
		expect(parsed.success).toBe(false);
		expect(parsed.error.type).toBe('flag-parse');
		expect(parsed.error.flag).toBe('body-file,comments-file');
		expect(parsed.error.message).toContain('stdin can only be drained once');
		expect(parsed.error.hint).toContain('temp file');
	});

	it('allows --body-file - paired with --comments-file <path>', async () => {
		mockReadFileSync.mockImplementation((target: unknown) => {
			if (target === 0) return 'stdin body';
			if (target === '/tmp/comments.json') return '[{"path":"x.ts","line":1,"body":"nit"}]';
			throw new Error(`unexpected readFileSync target: ${String(target)}`);
		});
		let capturedParams: Record<string, unknown> = {};
		const coreFn: CLICoreFn = async (params) => {
			capturedParams = params as Record<string, unknown>;
			return 'ok';
		};
		const CommandClass = createCLICommand(dualFileInputDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: {
				body: undefined,
				comments: undefined,
				'body-file': '-',
				'comments-file': '/tmp/comments.json',
			},
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		vi.spyOn(instance, 'log').mockImplementation(() => {});

		await instance.execute();

		expect(capturedParams.body).toBe('stdin body');
		expect(capturedParams.comments).toEqual([{ path: 'x.ts', line: 1, body: 'nit' }]);
	});

	it('allows --body-file <path> paired with --comments-file -', async () => {
		mockReadFileSync.mockImplementation((target: unknown) => {
			if (target === 0) return '[{"path":"x.ts","line":1,"body":"nit"}]';
			if (target === '/tmp/body.md') return 'review body from file';
			throw new Error(`unexpected readFileSync target: ${String(target)}`);
		});
		let capturedParams: Record<string, unknown> = {};
		const coreFn: CLICoreFn = async (params) => {
			capturedParams = params as Record<string, unknown>;
			return 'ok';
		};
		const CommandClass = createCLICommand(dualFileInputDef, coreFn);
		const instance = new CommandClass([], {});

		vi.spyOn(instance, 'parse').mockResolvedValue({
			flags: {
				body: undefined,
				comments: undefined,
				'body-file': '/tmp/body.md',
				'comments-file': '-',
			},
			args: {},
			argv: [],
			raw: [],
		} as unknown as Awaited<ReturnType<typeof instance.parse>>);

		vi.spyOn(instance, 'log').mockImplementation(() => {});

		await instance.execute();

		expect(capturedParams.body).toBe('review body from file');
		expect(capturedParams.comments).toEqual([{ path: 'x.ts', line: 1, body: 'nit' }]);
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

// ---------------------------------------------------------------------------
// Spec 014: manifest threads items / cliAliases / one example through
// ---------------------------------------------------------------------------

describe('generateToolManifest — widened fields (spec 014)', () => {
	it('threads items from array-of-object parameter into manifest entry', () => {
		const def: ToolDefinition = {
			name: 'ReviewPR',
			description: 'Review a PR.',
			parameters: {
				comments: {
					type: 'array',
					items: 'object',
					describe: 'Inline comments',
					optional: true,
				},
			},
		};

		const manifest = generateToolManifest(def);
		const commentsParam = manifest.parameters.comments as { type: string; items?: string };
		expect(commentsParam.items).toBe('object');
	});

	it('threads items from primitive-array parameter into manifest entry (regression guard)', () => {
		const def: ToolDefinition = {
			name: 'AddLabels',
			description: 'Add labels.',
			parameters: {
				labels: {
					type: 'array',
					items: 'string',
					describe: 'Labels to add',
					required: true,
				},
			},
		};

		const manifest = generateToolManifest(def);
		const labelsParam = manifest.parameters.labels as { type: string; items?: string };
		expect(labelsParam.items).toBe('string');
	});

	it('threads cliAliases into manifest as aliases', () => {
		const def: ToolDefinition = {
			name: 'ReviewPR',
			description: 'Review a PR.',
			parameters: {
				comments: {
					type: 'array',
					items: 'object',
					describe: 'Inline comments',
					cliAliases: ['comment'],
					optional: true,
				},
			},
		};

		const manifest = generateToolManifest(def);
		const commentsParam = manifest.parameters.comments as { aliases?: readonly string[] };
		expect(commentsParam.aliases).toEqual(['comment']);
	});

	it('attaches first matching example params value to the manifest entry as example', () => {
		const def: ToolDefinition = {
			name: 'ReviewPR',
			description: 'Review a PR.',
			parameters: {
				body: { type: 'string', describe: 'Body', required: true },
				comments: {
					type: 'array',
					items: 'object',
					describe: 'Inline comments',
					optional: true,
				},
			},
			examples: [
				{
					// First example has no comments → should be skipped when picking for the comments entry
					params: { body: 'lgtm' },
					comment: 'Approve with summary only',
				},
				{
					params: {
						body: 'needs work',
						comments: [{ path: 'src/x.ts', line: 10, body: 'nit' }],
					},
					comment: 'Request changes with inline',
				},
			],
		};

		const manifest = generateToolManifest(def);
		const commentsParam = manifest.parameters.comments as { example?: unknown };
		expect(commentsParam.example).toEqual([{ path: 'src/x.ts', line: 10, body: 'nit' }]);

		const bodyParam = manifest.parameters.body as { example?: unknown };
		// First example has body='lgtm' → that's the first match
		expect(bodyParam.example).toBe('lgtm');
	});

	it('omits example field when no examples populate the param', () => {
		const def: ToolDefinition = {
			name: 'ReviewPR',
			description: 'Review a PR.',
			parameters: {
				comments: {
					type: 'array',
					items: 'object',
					describe: 'Inline comments',
					optional: true,
				},
			},
			examples: [
				{
					params: {
						/* no comments here */
					},
					comment: 'no comments example',
				},
			],
		};

		const manifest = generateToolManifest(def);
		const commentsParam = manifest.parameters.comments as { example?: unknown };
		expect(commentsParam).not.toHaveProperty('example');
	});
});

// ---------------------------------------------------------------------------
// MNG-1059: manifest threads fileInputFor / fileInputAlternative cross-refs
// ---------------------------------------------------------------------------

describe('generateToolManifest — file-input metadata threading (MNG-1059)', () => {
	it('threads fileInputAlternative onto the direct text parameter when a file companion is declared', () => {
		const def: ToolDefinition = {
			name: 'PostPRComment',
			description: 'Post a PR comment.',
			parameters: {
				prNumber: { type: 'number', describe: 'PR number', required: true },
				body: { type: 'string', describe: 'The comment body', required: true },
			},
			cli: {
				fileInputAlternatives: [
					{
						paramName: 'body',
						fileFlag: 'body-file',
						description: 'Read body from file (use - for stdin)',
					},
				],
			},
		};

		const manifest = generateToolManifest(def);
		const bodyParam = manifest.parameters.body as { fileInputAlternative?: string };
		expect(bodyParam.fileInputAlternative).toBe('body-file');
	});

	it('threads fileInputFor onto the synthesized --*-file flag entry', () => {
		const def: ToolDefinition = {
			name: 'PostPRComment',
			description: 'Post a PR comment.',
			parameters: {
				body: { type: 'string', describe: 'The comment body', required: true },
			},
			cli: {
				fileInputAlternatives: [{ paramName: 'body', fileFlag: 'body-file' }],
			},
		};

		const manifest = generateToolManifest(def);
		const bodyFileParam = manifest.parameters['body-file'] as { fileInputFor?: string };
		expect(bodyFileParam.fileInputFor).toBe('body');
	});

	it('does not attach fileInputAlternative when no file companion is declared', () => {
		const def: ToolDefinition = {
			name: 'Simple',
			description: 'Simple tool.',
			parameters: {
				body: { type: 'string', describe: 'body', required: true },
			},
		};

		const manifest = generateToolManifest(def);
		const bodyParam = manifest.parameters.body as { fileInputAlternative?: string };
		expect(bodyParam.fileInputAlternative).toBeUndefined();
	});

	it('handles multiple file companions in a single definition', () => {
		const def: ToolDefinition = {
			name: 'ReviewPR',
			description: 'Review a PR.',
			parameters: {
				body: { type: 'string', describe: 'Review body', required: true },
				comments: {
					type: 'array',
					items: 'object',
					describe: 'Inline comments',
					optional: true,
				},
			},
			cli: {
				fileInputAlternatives: [
					{ paramName: 'body', fileFlag: 'body-file' },
					{ paramName: 'comments', fileFlag: 'comments-file', parseAs: 'json' },
				],
			},
		};

		const manifest = generateToolManifest(def);
		const bodyParam = manifest.parameters.body as { fileInputAlternative?: string };
		const commentsParam = manifest.parameters.comments as { fileInputAlternative?: string };
		const bodyFile = manifest.parameters['body-file'] as { fileInputFor?: string };
		const commentsFile = manifest.parameters['comments-file'] as { fileInputFor?: string };

		expect(bodyParam.fileInputAlternative).toBe('body-file');
		expect(commentsParam.fileInputAlternative).toBe('comments-file');
		expect(bodyFile.fileInputFor).toBe('body');
		expect(commentsFile.fileInputFor).toBe('comments');
	});
});

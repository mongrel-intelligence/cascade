/**
 * Unit tests for cliCommandFactory.
 *
 * Tests:
 * - Flag generation for all param types (string, number, boolean, enum, array, object)
 * - gadgetOnly params are excluded from generated CLI flags
 * - File-input resolution (--text-file reads file, prefers file over inline)
 * - owner/repo auto-resolution from env vars
 * - JSON success/error output format
 * - Error handling (success: false, error: message)
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock credential-scoping dependencies
// ---------------------------------------------------------------------------
vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn((_token: string, fn: () => Promise<void>) => fn()),
}));
vi.mock('../../../src/trello/client.js', () => ({
	withTrelloCredentials: vi.fn(
		(_creds: { apiKey: string; token: string }, fn: () => Promise<void>) => fn(),
	),
}));
vi.mock('../../../src/jira/client.js', () => ({
	withJiraCredentials: vi.fn(
		(_creds: { email: string; apiToken: string; baseUrl: string }, fn: () => Promise<void>) => fn(),
	),
}));
vi.mock('../../../src/pm/index.js', () => ({
	createPMProvider: vi.fn(() => ({})),
	withPMProvider: vi.fn((_provider: unknown, fn: () => Promise<void>) => fn()),
}));

import { createCLICommand } from '../../../src/gadgets/shared/cliCommandFactory.js';
import type { ToolDefinition } from '../../../src/gadgets/shared/toolDefinition.js';

/** Minimal oclif config to satisfy this.parse() */
const mockConfig = { runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }) };

let tmpDir: string;

/** Create a fresh minimal oclif config to satisfy this.parse() in each test */
function makeMockConfig() {
	return { runHook: vi.fn().mockResolvedValue({ successes: [], failures: [] }) };
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'cascade-factory-test-'));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

/** Write content to a temp file and return the path. */
function writeTempFile(filename: string, content: string): string {
	const filePath = join(tmpDir, filename);
	writeFileSync(filePath, content);
	return filePath;
}

// ---------------------------------------------------------------------------
// Helper — minimal ToolDefinition factory
// ---------------------------------------------------------------------------
function makeToolDef(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
	return {
		name: 'TestTool',
		description: 'A test tool',
		parameters: {},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Flag generation for all parameter types
// ---------------------------------------------------------------------------
describe('cliCommandFactory — flag generation', () => {
	it('generates string flags correctly', async () => {
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				message: { type: 'string', describe: 'A string param', required: true },
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--message', 'hello'], makeMockConfig() as never);
		await cmd.run();

		expect(coreFn).toHaveBeenCalledWith(expect.objectContaining({ message: 'hello' }));
	});

	it('generates number (integer) flags correctly', async () => {
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				count: { type: 'number', describe: 'A number param', required: true },
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--count', '42'], makeMockConfig() as never);
		await cmd.run();

		expect(coreFn).toHaveBeenCalledWith(expect.objectContaining({ count: 42 }));
	});

	it('generates boolean flags correctly', async () => {
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				verbose: { type: 'boolean', describe: 'A boolean param', optional: true },
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--verbose'], makeMockConfig() as never);
		await cmd.run();

		expect(coreFn).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
	});

	it('generates boolean flags with --no-<flag> negation when allowNo is set', async () => {
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				enabled: {
					type: 'boolean',
					describe: 'A boolean with allowNo',
					optional: true,
					default: true,
					allowNo: true,
				},
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--no-enabled'], makeMockConfig() as never);
		await cmd.run();

		expect(coreFn).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
	});

	it('generates enum flags with restricted options', async () => {
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				status: {
					type: 'enum',
					options: ['open', 'closed', 'draft'],
					describe: 'An enum param',
					required: true,
				},
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--status', 'open'], makeMockConfig() as never);
		await cmd.run();

		expect(coreFn).toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }));
	});

	it('generates array flags (multiple values)', async () => {
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				tags: { type: 'array', items: 'string', describe: 'An array param', optional: true },
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--tags', 'a', '--tags', 'b', '--tags', 'c'], makeMockConfig() as never);
		await cmd.run();

		expect(coreFn).toHaveBeenCalledWith(expect.objectContaining({ tags: ['a', 'b', 'c'] }));
	});

	it('generates object flags (JSON string)', async () => {
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				config: { type: 'object', describe: 'An object param (JSON string)', optional: true },
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--config', '{"key":"value","num":42}'], makeMockConfig() as never);
		await cmd.run();

		expect(coreFn).toHaveBeenCalledWith(
			expect.objectContaining({ config: { key: 'value', num: 42 } }),
		);
	});
});

// ---------------------------------------------------------------------------
// gadgetOnly exclusion
// ---------------------------------------------------------------------------
describe('cliCommandFactory — gadgetOnly param exclusion', () => {
	it('does not pass gadgetOnly params to the CLI flags', async () => {
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				comment: { type: 'string', describe: 'Rationale', required: true, gadgetOnly: true },
				message: { type: 'string', describe: 'CLI param', required: true },
			},
		});
		const Cmd = createCLICommand(def, coreFn);

		// Passing --message only should work (gadgetOnly "comment" has no CLI flag)
		const cmd = new Cmd(['--message', 'hello'], makeMockConfig() as never);
		await cmd.run();

		// coreFn is called without the gadgetOnly "comment" field
		expect(coreFn).toHaveBeenCalledWith(expect.objectContaining({ message: 'hello' }));
		// "comment" should NOT be present in the resolved params
		const callArg = vi.mocked(coreFn).mock.calls[0][0] as Record<string, unknown>;
		expect(callArg).not.toHaveProperty('comment');
	});

	it('raises an error when passing a gadgetOnly param as a flag', async () => {
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				comment: { type: 'string', describe: 'Rationale', required: true, gadgetOnly: true },
				message: { type: 'string', describe: 'CLI param', required: true },
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(
			['--comment', 'rationale', '--message', 'hello'],
			makeMockConfig() as never,
		);

		// The --comment flag doesn't exist in generated CLI flags, so oclif should throw
		await expect(cmd.run()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// File-input resolution
// ---------------------------------------------------------------------------
describe('cliCommandFactory — file-input resolution', () => {
	it('reads param value from file when file flag is provided', async () => {
		const filePath = writeTempFile('text.md', 'Content from file');
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				text: { type: 'string', describe: 'The text', required: true },
			},
			cli: {
				fileInputAlternatives: [
					{ paramName: 'text', fileFlag: 'text-file', description: 'Read text from file' },
				],
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--text-file', filePath], makeMockConfig() as never);
		await cmd.run();

		expect(coreFn).toHaveBeenCalledWith(expect.objectContaining({ text: 'Content from file' }));
	});

	it('prefers file flag over inline flag when both provided', async () => {
		const filePath = writeTempFile('text.md', 'from file');
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				text: { type: 'string', describe: 'The text', required: true },
			},
			cli: {
				fileInputAlternatives: [
					{ paramName: 'text', fileFlag: 'text-file', description: 'Read text from file' },
				],
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(
			['--text', 'from inline', '--text-file', filePath],
			makeMockConfig() as never,
		);
		await cmd.run();

		expect(coreFn).toHaveBeenCalledWith(expect.objectContaining({ text: 'from file' }));
	});

	it('uses inline value when only inline flag is provided', async () => {
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				text: { type: 'string', describe: 'The text', required: true },
			},
			cli: {
				fileInputAlternatives: [
					{ paramName: 'text', fileFlag: 'text-file', description: 'Read text from file' },
				],
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--text', 'from inline'], makeMockConfig() as never);
		await cmd.run();

		expect(coreFn).toHaveBeenCalledWith(expect.objectContaining({ text: 'from inline' }));
	});

	it('errors when required file-input param has neither inline nor file value', async () => {
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				text: { type: 'string', describe: 'The text', required: true },
			},
			cli: {
				fileInputAlternatives: [
					{ paramName: 'text', fileFlag: 'text-file', description: 'Read text from file' },
				],
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd([], makeMockConfig() as never);

		await expect(cmd.run()).rejects.toThrow('Either --text or --text-file is required');
	});

	it('handles files with special characters (quotes, backticks, $)', async () => {
		const content = 'Use `code` and "quotes" and $(command) and <<EOF';
		const filePath = writeTempFile('special.md', content);
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				text: { type: 'string', describe: 'The text', required: true },
			},
			cli: {
				fileInputAlternatives: [{ paramName: 'text', fileFlag: 'text-file' }],
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--text-file', filePath], makeMockConfig() as never);
		await cmd.run();

		expect(coreFn).toHaveBeenCalledWith(expect.objectContaining({ text: content }));
	});
});

// ---------------------------------------------------------------------------
// owner/repo auto-resolution
// ---------------------------------------------------------------------------
describe('cliCommandFactory — owner/repo auto-resolution', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			CASCADE_REPO_OWNER: 'env-owner',
			CASCADE_REPO_NAME: 'env-repo',
		};
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('resolves owner/repo from CASCADE_REPO_OWNER/CASCADE_REPO_NAME env vars', async () => {
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			parameters: {
				owner: { type: 'string', describe: 'Repo owner', required: true },
				repo: { type: 'string', describe: 'Repo name', required: true },
				prNumber: { type: 'number', describe: 'PR number', required: true },
			},
			cli: {
				autoResolved: [
					{ paramName: 'owner', envVar: 'CASCADE_REPO_OWNER', resolvedFrom: 'git-remote' },
					{ paramName: 'repo', envVar: 'CASCADE_REPO_NAME', resolvedFrom: 'git-remote' },
				],
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--prNumber', '5'], makeMockConfig() as never);
		await cmd.run();

		expect(coreFn).toHaveBeenCalledWith(
			expect.objectContaining({ owner: 'env-owner', repo: 'env-repo', prNumber: 5 }),
		);
	});
});

// ---------------------------------------------------------------------------
// JSON output format
// ---------------------------------------------------------------------------
describe('cliCommandFactory — JSON output format', () => {
	it('outputs { success: true, data: result } on success', async () => {
		const coreFn = vi.fn().mockResolvedValue({ id: 'result-1' });
		const def = makeToolDef({
			parameters: {
				name: { type: 'string', describe: 'A name', required: true },
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--name', 'test'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');
		await cmd.run();

		expect(logSpy).toHaveBeenCalledTimes(1);
		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output).toEqual({ success: true, data: { id: 'result-1' } });
	});

	it('outputs { success: false, error: message } on error', async () => {
		const coreFn = vi.fn().mockRejectedValue(new Error('Something went wrong'));
		const def = makeToolDef({
			parameters: {
				name: { type: 'string', describe: 'A name', required: true },
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--name', 'test'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');

		// Should not throw (error is caught internally) but may call this.exit(1)
		try {
			await cmd.run();
		} catch {
			// this.exit(1) throws in test environment — that's expected
		}

		expect(logSpy).toHaveBeenCalledTimes(1);
		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output).toEqual({ success: false, error: 'Something went wrong' });
	});

	it('handles non-Error throws and outputs error string', async () => {
		const coreFn = vi.fn().mockRejectedValue('string error');
		const def = makeToolDef({
			parameters: {
				name: { type: 'string', describe: 'A name', required: true },
			},
		});
		const Cmd = createCLICommand(def, coreFn);
		const cmd = new Cmd(['--name', 'test'], makeMockConfig() as never);
		const logSpy = vi.spyOn(cmd, 'log');

		try {
			await cmd.run();
		} catch {
			// this.exit(1) may throw
		}

		const output = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(output.success).toBe(false);
		expect(output.error).toBe('string error');
	});

	it('includes the description from the ToolDefinition', () => {
		const coreFn = vi.fn().mockResolvedValue('ok');
		const def = makeToolDef({
			description: 'My test tool description',
			parameters: {},
		});
		const Cmd = createCLICommand(def, coreFn);

		// Access static property directly on the class
		expect((Cmd as { description?: string }).description).toBe('My test tool description');
	});
});

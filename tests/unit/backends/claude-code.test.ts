import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the SDK before importing the backend
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
	query: vi.fn(),
}));

import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import {
	ClaudeCodeBackend,
	buildEnv,
	buildSystemPrompt,
	buildTaskPrompt,
	buildToolGuidance,
	ensureOnboardingFlag,
	installCredentials,
	resolveClaudeModel,
} from '../../../src/backends/claude-code/index.js';
import type { AgentBackendInput, ToolManifest } from '../../../src/backends/types.js';

const mockQuery = vi.mocked(query);

/** Remove an env var without triggering biome's noDelete rule. */
function unsetEnv(key: string) {
	Reflect.deleteProperty(process.env, key);
}

const sampleTools: ToolManifest[] = [
	{
		name: 'ReadTrelloCard',
		description: 'Read a Trello card.',
		cliCommand: 'cascade-tools trello read-card',
		parameters: {
			cardId: { type: 'string', required: true },
			includeComments: { type: 'boolean' },
		},
	},
	{
		name: 'Finish',
		description: 'Signal session completion.',
		cliCommand: 'cascade-tools session finish',
		parameters: { comment: { type: 'string', required: true } },
	},
];

function makeInput(overrides: Partial<AgentBackendInput> = {}): AgentBackendInput {
	return {
		agentType: 'implementation',
		project: { id: 'test', name: 'Test', repo: 'o/r' } as AgentBackendInput['project'],
		config: { defaults: {} } as AgentBackendInput['config'],
		repoDir: '/tmp/repo',
		systemPrompt: 'You are an agent.',
		taskPrompt: 'Implement feature X.',
		cliToolsDir: '/usr/bin',
		availableTools: sampleTools,
		contextInjections: [],
		maxIterations: 20,
		budgetUsd: 5,
		model: 'claude-sonnet-4-5-20250929',
		progressReporter: {
			onIteration: vi.fn().mockResolvedValue(undefined),
			onToolCall: vi.fn(),
			onText: vi.fn(),
		},
		logWriter: vi.fn(),
		agentInput: { cardId: 'c1' } as AgentBackendInput['agentInput'],
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('buildToolGuidance', () => {
	it('returns empty string for empty tools', () => {
		expect(buildToolGuidance([])).toBe('');
	});

	it('generates markdown reference for tools', () => {
		const guidance = buildToolGuidance(sampleTools);
		expect(guidance).toContain('## CASCADE Tools');
		expect(guidance).toContain('### ReadTrelloCard');
		expect(guidance).toContain('cascade-tools trello read-card');
		expect(guidance).toContain('--cardId <string>');
		expect(guidance).toContain('[--includeComments <boolean>]');
		expect(guidance).toContain('### Finish');
		expect(guidance).toContain('--comment <string>');
	});

	it('marks required params without brackets', () => {
		const guidance = buildToolGuidance(sampleTools);
		// Required param has no brackets
		expect(guidance).toContain(' --cardId <string>');
		expect(guidance).not.toContain('[--cardId');
	});

	it('marks optional params with brackets', () => {
		const guidance = buildToolGuidance(sampleTools);
		expect(guidance).toContain('[--includeComments <boolean>]');
	});
});

describe('buildTaskPrompt', () => {
	it('returns task prompt without injections', () => {
		expect(buildTaskPrompt('Do the thing.', [])).toBe('Do the thing.');
	});

	it('appends context injections', () => {
		const prompt = buildTaskPrompt('Do the thing.', [
			{
				toolName: 'ReadTrelloCard',
				params: { cardId: 'abc' },
				result: '{"title":"My card"}',
				description: 'Pre-fetched Trello card data',
			},
		]);
		expect(prompt).toContain('## Pre-loaded Context');
		expect(prompt).toContain('### Pre-fetched Trello card data (ReadTrelloCard)');
		expect(prompt).toContain('"cardId":"abc"');
		expect(prompt).toContain('{"title":"My card"}');
	});
});

describe('buildSystemPrompt', () => {
	it('appends tool guidance to system prompt', () => {
		const result = buildSystemPrompt('You are an agent.', sampleTools);
		expect(result).toContain('You are an agent.');
		expect(result).toContain('## CASCADE Tools');
	});

	it('returns system prompt unchanged when no tools', () => {
		expect(buildSystemPrompt('You are an agent.', [])).toBe('You are an agent.');
	});
});

describe('resolveClaudeModel', () => {
	it('passes through claude-* models', () => {
		expect(resolveClaudeModel('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5-20250929');
		expect(resolveClaudeModel('claude-opus-4-20250514')).toBe('claude-opus-4-20250514');
	});

	it('strips anthropic: prefix', () => {
		expect(resolveClaudeModel('anthropic:claude-sonnet-4-5-20250929')).toBe(
			'claude-sonnet-4-5-20250929',
		);
	});

	it('falls back to sonnet for non-Claude models', () => {
		expect(resolveClaudeModel('openrouter:google/gemini-3-flash-preview')).toBe(
			'claude-sonnet-4-5-20250929',
		);
		expect(resolveClaudeModel('gpt-4o')).toBe('claude-sonnet-4-5-20250929');
	});
});

describe('ClaudeCodeBackend', () => {
	it('has name "claude-code"', () => {
		const backend = new ClaudeCodeBackend();
		expect(backend.name).toBe('claude-code');
	});

	it('supportsAgentType returns true for any type', () => {
		const backend = new ClaudeCodeBackend();
		expect(backend.supportsAgentType('implementation')).toBe(true);
		expect(backend.supportsAgentType('review')).toBe(true);
		expect(backend.supportsAgentType('briefing')).toBe(true);
		expect(backend.supportsAgentType('anything')).toBe(true);
	});
});

describe('execute', () => {
	function mockStream(messages: Array<{ type: string; [key: string]: unknown }>) {
		const iterator = messages[Symbol.iterator]();
		const asyncIterator = {
			[Symbol.asyncIterator]() {
				return {
					next() {
						const result = iterator.next();
						return Promise.resolve(result);
					},
				};
			},
		};
		mockQuery.mockReturnValue(asyncIterator as ReturnType<typeof query>);
	}

	it('calls query with correct options', async () => {
		mockStream([
			{
				type: 'result',
				subtype: 'success',
				result: 'Done',
				total_cost_usd: 0.01,
				num_turns: 1,
			},
		]);

		const backend = new ClaudeCodeBackend();
		await backend.execute(makeInput());

		expect(mockQuery).toHaveBeenCalledWith({
			prompt: expect.stringContaining('Implement feature X.'),
			options: expect.objectContaining({
				model: 'claude-sonnet-4-5-20250929',
				cwd: '/tmp/repo',
				maxTurns: 20,
				maxBudgetUsd: 5,
				permissionMode: 'bypassPermissions',
				allowDangerouslySkipPermissions: true,
				persistSession: false,
			}),
		});
	});

	it('returns success result', async () => {
		mockStream([
			{
				type: 'result',
				subtype: 'success',
				result: 'Task completed successfully.',
				total_cost_usd: 0.05,
				num_turns: 3,
			},
		]);

		const backend = new ClaudeCodeBackend();
		const result = await backend.execute(makeInput());

		expect(result.success).toBe(true);
		expect(result.output).toBe('Task completed successfully.');
		expect(result.cost).toBe(0.05);
		expect(result.error).toBeUndefined();
	});

	it('returns error result on max turns', async () => {
		mockStream([
			{
				type: 'result',
				subtype: 'error_max_turns',
				errors: ['Exceeded maximum turns'],
				total_cost_usd: 1.5,
				num_turns: 20,
			},
		]);

		const backend = new ClaudeCodeBackend();
		const result = await backend.execute(makeInput());

		expect(result.success).toBe(false);
		expect(result.error).toBe('Exceeded maximum turns');
		expect(result.cost).toBe(1.5);
	});

	it('reports progress on assistant messages', async () => {
		mockStream([
			{
				type: 'assistant',
				message: {
					content: [
						{ type: 'text', text: 'Analyzing...' },
						{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/f.ts' } },
					],
				},
				uuid: 'uuid-1',
				session_id: 's1',
				parent_tool_use_id: null,
			},
			{
				type: 'result',
				subtype: 'success',
				result: 'Done',
				total_cost_usd: 0.01,
				num_turns: 1,
			},
		]);

		const input = makeInput();
		const backend = new ClaudeCodeBackend();
		await backend.execute(input);

		expect(input.progressReporter.onIteration).toHaveBeenCalledWith(1, 20);
		expect(input.progressReporter.onText).toHaveBeenCalledWith('Analyzing...');
		expect(input.progressReporter.onToolCall).toHaveBeenCalledWith('Read', {
			file_path: '/tmp/f.ts',
		});
	});

	it('extracts finish comment from Bash cascade-tools call', async () => {
		mockStream([
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'tool_use',
							name: 'Bash',
							input: { command: 'cascade-tools session finish --comment "All done"' },
						},
					],
				},
				uuid: 'uuid-1',
				session_id: 's1',
				parent_tool_use_id: null,
			},
			{
				type: 'result',
				subtype: 'success',
				result: '',
				total_cost_usd: 0.02,
				num_turns: 1,
			},
		]);

		const backend = new ClaudeCodeBackend();
		const result = await backend.execute(makeInput());

		expect(result.success).toBe(true);
		expect(result.output).toBe('All done');
	});

	it('resolves model for non-Claude models', async () => {
		mockStream([
			{
				type: 'result',
				subtype: 'success',
				result: 'Done',
				total_cost_usd: 0.01,
				num_turns: 1,
			},
		]);

		const backend = new ClaudeCodeBackend();
		await backend.execute(makeInput({ model: 'openrouter:google/gemini-3-flash' }));

		expect(mockQuery).toHaveBeenCalledWith(
			expect.objectContaining({
				options: expect.objectContaining({
					model: 'claude-sonnet-4-5-20250929',
				}),
			}),
		);
	});

	it('ignores non-assistant non-result messages', async () => {
		mockStream([
			{ type: 'system', subtype: 'init' },
			{ type: 'user', message: {} },
			{
				type: 'result',
				subtype: 'success',
				result: 'Done',
				total_cost_usd: 0.01,
				num_turns: 0,
			},
		]);

		const input = makeInput();
		const backend = new ClaudeCodeBackend();
		const result = await backend.execute(input);

		expect(result.success).toBe(true);
		expect(input.progressReporter.onIteration).not.toHaveBeenCalled();
	});

	it('installs credentials and cleans up temp dir', async () => {
		const fakeCreds = '{"claudeAiOauth":{"accessToken":"test"}}';
		process.env.CLAUDE_CREDENTIALS = fakeCreds;

		mockStream([
			{
				type: 'result',
				subtype: 'success',
				result: 'Done',
				total_cost_usd: 0.01,
				num_turns: 1,
			},
		]);

		const backend = new ClaudeCodeBackend();
		const input = makeInput();
		await backend.execute(input);

		// Verify CLAUDE_CONFIG_DIR was passed to query
		expect(mockQuery).toHaveBeenCalledWith(
			expect.objectContaining({
				options: expect.objectContaining({
					env: expect.objectContaining({
						CLAUDE_CONFIG_DIR: expect.stringContaining('cascade-claude-'),
						CLAUDE_CREDENTIALS: fakeCreds,
					}),
				}),
			}),
		);

		// The temp dir should have been cleaned up after execution
		const call = mockQuery.mock.calls[0];
		expect(call).toBeDefined();
		const callArgs = call[0] as { options: { env: Record<string, string> } };
		const configDir = callArgs.options.env.CLAUDE_CONFIG_DIR;
		expect(existsSync(configDir)).toBe(false);

		unsetEnv('CLAUDE_CREDENTIALS');
	});
});

describe('installCredentials', () => {
	it('writes .credentials.json to temp dir with mode 0o600', async () => {
		const fakeCreds = '{"claudeAiOauth":{"accessToken":"test-token"}}';
		const configDir = installCredentials(fakeCreds);

		try {
			const credPath = join(configDir, '.credentials.json');
			expect(existsSync(credPath)).toBe(true);
			expect(readFileSync(credPath, 'utf8')).toBe(fakeCreds);

			const stats = statSync(credPath);
			expect(stats.mode & 0o777).toBe(0o600);
		} finally {
			await rm(configDir, { recursive: true, force: true });
		}
	});
});

describe('ensureOnboardingFlag', () => {
	let fakeHome: string;
	let originalHome: string | undefined;

	beforeEach(() => {
		fakeHome = mkdtempSync(join(tmpdir(), 'cascade-test-home-'));
		originalHome = process.env.HOME;
		process.env.HOME = fakeHome;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		await rm(fakeHome, { recursive: true, force: true });
	});

	it('creates $HOME/.claude.json with onboarding flag', () => {
		ensureOnboardingFlag();

		const claudeJsonPath = join(fakeHome, '.claude.json');
		expect(existsSync(claudeJsonPath)).toBe(true);

		const content = JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
		expect(content).toEqual({ hasCompletedOnboarding: true });

		const stats = statSync(claudeJsonPath);
		expect(stats.mode & 0o777).toBe(0o600);
	});

	it('does not overwrite existing $HOME/.claude.json', async () => {
		const existingContent = '{"hasCompletedOnboarding":true,"custom":"data"}';
		const claudeJsonPath = join(fakeHome, '.claude.json');
		const { writeFileSync: writeFs } = await import('node:fs');
		writeFs(claudeJsonPath, existingContent);

		ensureOnboardingFlag();

		expect(readFileSync(claudeJsonPath, 'utf8')).toBe(existingContent);
	});
});

describe('buildEnv', () => {
	it('sets CLAUDE_CONFIG_DIR when CLAUDE_CREDENTIALS is set', async () => {
		const fakeCreds = '{"claudeAiOauth":{"accessToken":"test"}}';
		process.env.CLAUDE_CREDENTIALS = fakeCreds;

		try {
			const result = buildEnv();
			const { env, configDir } = result;
			expect(configDir).toBeDefined();
			expect(env.CLAUDE_CONFIG_DIR).toBe(configDir);
			expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('cascade/1.0.0');

			// Verify credentials were written
			const dir = configDir as string;
			const credPath = join(dir, '.credentials.json');
			expect(readFileSync(credPath, 'utf8')).toBe(fakeCreds);

			await rm(dir, { recursive: true, force: true });
		} finally {
			unsetEnv('CLAUDE_CREDENTIALS');
		}
	});

	it('does not set CLAUDE_CONFIG_DIR when CLAUDE_CREDENTIALS is not set', () => {
		unsetEnv('CLAUDE_CREDENTIALS');

		const { env, configDir } = buildEnv();
		expect(configDir).toBeUndefined();
		expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
		expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('cascade/1.0.0');
	});

	it('strips NODE_OPTIONS and VSCODE_INSPECTOR_OPTIONS from env', () => {
		process.env.NODE_OPTIONS = '--inspect=9229';
		process.env.VSCODE_INSPECTOR_OPTIONS = '{"some":"config"}';
		unsetEnv('CLAUDE_CREDENTIALS');

		try {
			const { env } = buildEnv();
			expect(env.NODE_OPTIONS).toBeUndefined();
			expect(env.VSCODE_INSPECTOR_OPTIONS).toBeUndefined();
		} finally {
			unsetEnv('NODE_OPTIONS');
			unsetEnv('VSCODE_INSPECTOR_OPTIONS');
		}
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the SDK before importing the backend
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
	query: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
	resolveClaudeModel,
} from '../../../src/backends/claude-code/index.js';
import {
	CLAUDE_CODE_MODELS,
	CLAUDE_CODE_MODEL_IDS,
	DEFAULT_CLAUDE_CODE_MODEL,
} from '../../../src/backends/claude-code/models.js';
import type { AgentBackendInput, ToolManifest } from '../../../src/backends/types.js';
import { logger } from '../../../src/utils/logging.js';

const mockQuery = vi.mocked(query);

/** Remove an env var without triggering biome's noDelete rule. */
function unsetEnv(key: string) {
	Reflect.deleteProperty(process.env, key);
}

const sampleTools: ToolManifest[] = [
	{
		name: 'ReadWorkItem',
		description: 'Read a work item.',
		cliCommand: 'cascade-tools pm read-work-item',
		parameters: {
			workItemId: { type: 'string', required: true },
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
		expect(guidance).toContain('### ReadWorkItem');
		expect(guidance).toContain('cascade-tools pm read-work-item');
		expect(guidance).toContain('--workItemId <string>');
		expect(guidance).toContain('[--includeComments <boolean>]');
		expect(guidance).toContain('### Finish');
		expect(guidance).toContain('--comment <string>');
	});

	it('marks required params without brackets', () => {
		const guidance = buildToolGuidance(sampleTools);
		// Required param has no brackets
		expect(guidance).toContain(' --workItemId <string>');
		expect(guidance).not.toContain('[--workItemId');
	});

	it('marks optional params with brackets', () => {
		const guidance = buildToolGuidance(sampleTools);
		expect(guidance).toContain('[--includeComments <boolean>]');
	});

	it('renders array params as repeatable flags with singular name', () => {
		const tools: ToolManifest[] = [
			{
				name: 'AddChecklist',
				description: 'Add a checklist.',
				cliCommand: 'cascade-tools pm add-checklist',
				parameters: {
					workItemId: { type: 'string', required: true },
					item: { type: 'array', required: true },
				},
			},
		];
		const guidance = buildToolGuidance(tools);
		expect(guidance).toContain('--item <string> (repeatable)');
		expect(guidance).not.toContain('<array>');
	});

	it('renders optional array params with brackets and repeatable hint', () => {
		const tools: ToolManifest[] = [
			{
				name: 'TestTool',
				description: 'Test.',
				cliCommand: 'cascade-tools test',
				parameters: {
					tags: { type: 'array' },
				},
			},
		];
		const guidance = buildToolGuidance(tools);
		expect(guidance).toContain('[--tag <string> (repeatable)]');
	});
});

describe('buildTaskPrompt', () => {
	it('returns task prompt without injections', () => {
		expect(buildTaskPrompt('Do the thing.', [])).toBe('Do the thing.');
	});

	it('appends context injections', () => {
		const prompt = buildTaskPrompt('Do the thing.', [
			{
				toolName: 'ReadWorkItem',
				params: { workItemId: 'abc' },
				result: '{"title":"My card"}',
				description: 'Pre-fetched work item data',
			},
		]);
		expect(prompt).toContain('## Pre-loaded Context');
		expect(prompt).toContain('### Pre-fetched work item data (ReadWorkItem)');
		expect(prompt).toContain('"workItemId":"abc"');
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

describe('CLAUDE_CODE_MODELS constants', () => {
	it('contains three models', () => {
		expect(CLAUDE_CODE_MODELS).toHaveLength(3);
	});

	it('has value/label pairs', () => {
		for (const m of CLAUDE_CODE_MODELS) {
			expect(m.value).toBeTruthy();
			expect(m.label).toBeTruthy();
		}
	});

	it('CLAUDE_CODE_MODEL_IDS matches model values', () => {
		expect(CLAUDE_CODE_MODEL_IDS).toEqual(CLAUDE_CODE_MODELS.map((m) => m.value));
	});

	it('DEFAULT_CLAUDE_CODE_MODEL is a known model ID', () => {
		expect(CLAUDE_CODE_MODEL_IDS).toContain(DEFAULT_CLAUDE_CODE_MODEL);
	});
});

describe('resolveClaudeModel', () => {
	it('passes through known Claude Code model IDs', () => {
		expect(resolveClaudeModel('claude-opus-4-6')).toBe('claude-opus-4-6');
		expect(resolveClaudeModel('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5-20250929');
		expect(resolveClaudeModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5-20251001');
	});

	it('passes through other claude-* models', () => {
		expect(resolveClaudeModel('claude-opus-4-20250514')).toBe('claude-opus-4-20250514');
	});

	it('strips anthropic: prefix', () => {
		expect(resolveClaudeModel('anthropic:claude-sonnet-4-5-20250929')).toBe(
			'claude-sonnet-4-5-20250929',
		);
	});

	it('falls back to default for non-Claude models', () => {
		expect(resolveClaudeModel('openrouter:google/gemini-3-flash-preview')).toBe(
			DEFAULT_CLAUDE_CODE_MODEL,
		);
		expect(resolveClaudeModel('gpt-4o')).toBe(DEFAULT_CLAUDE_CODE_MODEL);
	});

	it('logs a warning when falling back', () => {
		vi.mocked(logger.warn).mockClear();
		resolveClaudeModel('gpt-4o');
		expect(logger.warn).toHaveBeenCalledWith(
			'Non-Claude model configured for Claude Code backend, falling back to default',
			{ configured: 'gpt-4o', fallback: DEFAULT_CLAUDE_CODE_MODEL },
		);
	});

	it('does not warn for valid Claude models', () => {
		vi.mocked(logger.warn).mockClear();
		resolveClaudeModel('claude-sonnet-4-5-20250929');
		expect(logger.warn).not.toHaveBeenCalled();
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
				maxBudgetUsd: 5,
				permissionMode: 'bypassPermissions',
				allowDangerouslySkipPermissions: true,
				persistSession: false,
				hooks: expect.objectContaining({
					PreToolUse: expect.arrayContaining([expect.objectContaining({ matcher: 'Bash' })]),
					Stop: expect.arrayContaining([expect.objectContaining({ hooks: expect.any(Array) })]),
				}),
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

	it('extracts prUrl from result text', async () => {
		mockStream([
			{
				type: 'result',
				subtype: 'success',
				result: 'Created PR: https://github.com/owner/repo/pull/42',
				total_cost_usd: 0.05,
				num_turns: 5,
			},
		]);

		const backend = new ClaudeCodeBackend();
		const result = await backend.execute(makeInput());

		expect(result.success).toBe(true);
		expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42');
	});

	it('extracts prUrl from assistant messages when not in result text', async () => {
		mockStream([
			{
				type: 'assistant',
				message: {
					content: [
						{
							type: 'text',
							text: 'PR created at https://github.com/owner/repo/pull/99',
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
				result: 'Done',
				total_cost_usd: 0.03,
				num_turns: 2,
			},
		]);

		const backend = new ClaudeCodeBackend();
		const result = await backend.execute(makeInput());

		expect(result.success).toBe(true);
		expect(result.prUrl).toBe('https://github.com/owner/repo/pull/99');
	});

	it('returns undefined prUrl when no PR URL present', async () => {
		mockStream([
			{
				type: 'result',
				subtype: 'success',
				result: 'Done with no PR',
				total_cost_usd: 0.01,
				num_turns: 1,
			},
		]);

		const backend = new ClaudeCodeBackend();
		const result = await backend.execute(makeInput());

		expect(result.success).toBe(true);
		expect(result.prUrl).toBeUndefined();
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

	it('ignores non-assistant non-result non-system messages', async () => {
		mockStream([
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

	it('logs truncated agent text content', async () => {
		const longText = 'A'.repeat(400);
		mockStream([
			{
				type: 'assistant',
				message: {
					content: [{ type: 'text', text: longText }],
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

		expect(input.logWriter).toHaveBeenCalledWith('INFO', 'Agent text', {
			text: `${'A'.repeat(300)}...`,
		});
	});

	it('logs assistant message errors', async () => {
		mockStream([
			{
				type: 'assistant',
				message: { content: [] },
				error: 'rate_limit',
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

		expect(input.logWriter).toHaveBeenCalledWith('ERROR', 'Assistant message error', {
			error: 'rate_limit',
			turn: 1,
		});
	});

	it('logs token usage per turn', async () => {
		mockStream([
			{
				type: 'assistant',
				message: {
					content: [],
					usage: { input_tokens: 1000, output_tokens: 500 },
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

		expect(input.logWriter).toHaveBeenCalledWith('DEBUG', 'Token usage', {
			turn: 1,
			inputTokens: 1000,
			outputTokens: 500,
		});
	});

	it('logs SDK system init events', async () => {
		mockStream([
			{
				type: 'system',
				subtype: 'init',
				model: 'claude-sonnet-4-5-20250929',
				claude_code_version: '1.0.0',
				tools: ['Read', 'Write', 'Bash'],
				uuid: 'uuid-sys',
				session_id: 's1',
			},
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
		await backend.execute(input);

		expect(input.logWriter).toHaveBeenCalledWith('INFO', 'Claude Code session initialized', {
			model: 'claude-sonnet-4-5-20250929',
			claudeCodeVersion: '1.0.0',
			tools: ['Read', 'Write', 'Bash'],
		});
	});

	it('logs SDK system status events', async () => {
		mockStream([
			{
				type: 'system',
				subtype: 'status',
				status: 'compacting',
				uuid: 'uuid-sys',
				session_id: 's1',
			},
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
		await backend.execute(input);

		expect(input.logWriter).toHaveBeenCalledWith('INFO', 'Session status change', {
			status: 'compacting',
		});
	});

	it('includes durationMs and prUrl in completion log', async () => {
		mockStream([
			{
				type: 'result',
				subtype: 'success',
				result: 'Created PR: https://github.com/owner/repo/pull/42',
				total_cost_usd: 0.05,
				num_turns: 3,
			},
		]);

		const input = makeInput();
		const backend = new ClaudeCodeBackend();
		await backend.execute(input);

		expect(input.logWriter).toHaveBeenCalledWith(
			'INFO',
			'Claude Code SDK execution completed',
			expect.objectContaining({
				success: true,
				durationMs: expect.any(Number),
				prUrl: 'https://github.com/owner/repo/pull/42',
			}),
		);
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
	it('sets CLAUDE_AGENT_SDK_CLIENT_APP', () => {
		const { env } = buildEnv();
		expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('cascade/1.0.0');
	});

	it('passes through CLAUDE_CODE_OAUTH_TOKEN from environment', () => {
		process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test';

		try {
			const { env } = buildEnv();
			expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-test');
		} finally {
			unsetEnv('CLAUDE_CODE_OAUTH_TOKEN');
		}
	});

	it('strips NODE_OPTIONS and VSCODE_INSPECTOR_OPTIONS from env', () => {
		process.env.NODE_OPTIONS = '--inspect=9229';
		process.env.VSCODE_INSPECTOR_OPTIONS = '{"some":"config"}';

		try {
			const { env } = buildEnv();
			expect(env.NODE_OPTIONS).toBeUndefined();
			expect(env.VSCODE_INSPECTOR_OPTIONS).toBeUndefined();
		} finally {
			unsetEnv('NODE_OPTIONS');
			unsetEnv('VSCODE_INSPECTOR_OPTIONS');
		}
	});

	it('injects projectSecrets into env, overriding process.env', () => {
		process.env.GITHUB_TOKEN = 'global-token';

		try {
			const { env } = buildEnv({ GITHUB_TOKEN: 'project-token', TRELLO_API_KEY: 'proj-key' });
			expect(env.GITHUB_TOKEN).toBe('project-token');
			expect(env.TRELLO_API_KEY).toBe('proj-key');
		} finally {
			unsetEnv('GITHUB_TOKEN');
		}
	});

	it('uses process.env values when no projectSecrets provided', () => {
		process.env.GITHUB_TOKEN = 'global-token';

		try {
			const { env } = buildEnv();
			expect(env.GITHUB_TOKEN).toBe('global-token');
		} finally {
			unsetEnv('GITHUB_TOKEN');
		}
	});
});

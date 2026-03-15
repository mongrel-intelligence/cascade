import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the SDK before importing the engine
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
	query: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockStoreLlmCall = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	storeLlmCall: (...args: unknown[]) => mockStoreLlmCall(...args),
}));

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import {
	ClaudeCodeEngine,
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
import { resolveClaudeCodeSettings } from '../../../src/backends/claude-code/settings.js';
import type { AgentExecutionPlan, ToolManifest } from '../../../src/backends/types.js';

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

function makeInput(overrides: Partial<AgentExecutionPlan> = {}): AgentExecutionPlan {
	return {
		agentType: 'implementation',
		project: { id: 'test', name: 'Test', repo: 'o/r' } as AgentExecutionPlan['project'],
		config: { projects: [] } as AgentExecutionPlan['config'],
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
		agentInput: { workItemId: 'c1' } as AgentExecutionPlan['agentInput'],
		...overrides,
	};
}

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
		expect(guidance).toContain('[--includeComments]');
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
		expect(guidance).toContain('[--includeComments]');
		expect(guidance).not.toContain('<boolean>');
	});

	it('renders boolean flags with default:true as --no-flag', () => {
		const tools: ToolManifest[] = [
			{
				name: 'TestTool',
				description: 'Test.',
				cliCommand: 'cascade-tools test',
				parameters: {
					includeComments: { type: 'boolean', default: true },
					'no-includeComments': { type: 'boolean' },
				},
			},
		];
		const guidance = buildToolGuidance(tools);
		expect(guidance).toContain('[--no-includeComments]');
		expect(guidance).not.toContain('<boolean>');
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

	it('renders parameter description as inline comment', () => {
		const tools: ToolManifest[] = [
			{
				name: 'UpdateWorkItem',
				description: 'Update a work item.',
				cliCommand: 'cascade-tools pm update-work-item',
				parameters: {
					workItemId: { type: 'string', required: true },
					'description-file': {
						type: 'string',
						description:
							'Path to file with description (prefer over --description for long content)',
					},
				},
			},
		];
		const guidance = buildToolGuidance(tools);
		expect(guidance).toContain('--workItemId <string>');
		expect(guidance).toContain(
			'[--description-file <string>] # Path to file with description (prefer over --description for long content)',
		);
	});

	it('does not render comment when parameter has no description', () => {
		const tools: ToolManifest[] = [
			{
				name: 'TestTool',
				description: 'Test.',
				cliCommand: 'cascade-tools test',
				parameters: {
					name: { type: 'string', required: true },
				},
			},
		];
		const guidance = buildToolGuidance(tools);
		expect(guidance).toContain(' --name <string>');
		expect(guidance).not.toContain('--name <string>] #');
		expect(guidance).not.toContain('--name <string> #');
	});
});

describe('buildTaskPrompt', () => {
	let fakeRepoDir: string;

	beforeEach(() => {
		fakeRepoDir = mkdtempSync(join(tmpdir(), 'cascade-test-repo-'));
	});

	afterEach(async () => {
		await rm(fakeRepoDir, { recursive: true, force: true });
	});

	it('returns task prompt without injections', async () => {
		const result = await buildTaskPrompt('Do the thing.', [], fakeRepoDir);
		expect(result.prompt).toBe('Do the thing.');
		expect(result.hasOffloadedContext).toBe(false);
	});

	it('appends context injections inline when small', async () => {
		const result = await buildTaskPrompt(
			'Do the thing.',
			[
				{
					toolName: 'ReadWorkItem',
					params: { workItemId: 'abc' },
					result: '{"title":"My card"}',
					description: 'Pre-fetched work item data',
				},
			],
			fakeRepoDir,
		);
		expect(result.prompt).toContain('## Pre-loaded Context');
		expect(result.prompt).toContain('### Pre-fetched work item data (ReadWorkItem)');
		expect(result.prompt).toContain('"workItemId":"abc"');
		expect(result.prompt).toContain('{"title":"My card"}');
		expect(result.hasOffloadedContext).toBe(false);
	});

	it('offloads large context to files and generates instructions', async () => {
		// Create content larger than 8000 token threshold (~32000 chars)
		const largeContent = 'X'.repeat(40_000);
		const result = await buildTaskPrompt(
			'Review the PR.',
			[
				{
					toolName: 'GetPRDiff',
					params: { prNumber: 123 },
					result: largeContent,
					description: 'PR Diff',
				},
			],
			fakeRepoDir,
		);
		// Should not have inline content for the large injection
		expect(result.prompt).not.toContain('## Pre-loaded Context');
		expect(result.prompt).not.toContain(largeContent);

		// Should have instructions for reading offloaded files
		expect(result.prompt).toContain('## Context Files');
		expect(result.prompt).toContain('.cascade/context/');
		expect(result.prompt).toContain('Read tool');
		expect(result.hasOffloadedContext).toBe(true);

		// Verify file was written
		const contextDir = join(fakeRepoDir, '.cascade/context');
		expect(existsSync(contextDir)).toBe(true);
	});
});

describe('buildSystemPrompt', () => {
	it('appends tool guidance to system prompt', () => {
		const result = buildSystemPrompt('You are an agent.', sampleTools);
		expect(result).toContain('You are an agent.');
		expect(result).toContain('## Native Tool Execution Rules');
		expect(result).toContain('Never write pseudo tool calls');
		expect(result).toContain('## CASCADE Tools');
	});

	it('returns system prompt unchanged when no tools', () => {
		const result = buildSystemPrompt('You are an agent.', []);
		expect(result).toContain('## Native Tool Execution Rules');
		expect(result).toContain('You are an agent.');
	});
});

describe('CLAUDE_CODE_MODELS constants', () => {
	it('contains four models', () => {
		expect(CLAUDE_CODE_MODELS).toHaveLength(4);
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
		expect(resolveClaudeModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
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

	it('throws for incompatible models', () => {
		expect(() => resolveClaudeModel('openrouter:google/gemini-3-flash-preview')).toThrow(
			'not compatible with the Claude Code engine',
		);
		expect(() => resolveClaudeModel('gpt-4o')).toThrow(
			'not compatible with the Claude Code engine',
		);
	});
});

describe('ClaudeCodeEngine', () => {
	it('has engine id "claude-code"', () => {
		const engine = new ClaudeCodeEngine();
		expect(engine.definition.id).toBe('claude-code');
	});

	it('supportsAgentType returns true for any type', () => {
		const engine = new ClaudeCodeEngine();
		expect(engine.supportsAgentType('implementation')).toBe(true);
		expect(engine.supportsAgentType('review')).toBe(true);
		expect(engine.supportsAgentType('splitting')).toBe(true);
		expect(engine.supportsAgentType('anything')).toBe(true);
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

		const engine = new ClaudeCodeEngine();
		await engine.execute(makeInput());

		expect(mockQuery).toHaveBeenCalledWith({
			prompt: expect.stringContaining('Implement feature X.'),
			options: expect.objectContaining({
				model: 'claude-sonnet-4-5-20250929',
				cwd: '/tmp/repo',
				maxBudgetUsd: 5,
				permissionMode: 'bypassPermissions',
				allowDangerouslySkipPermissions: true,
				persistSession: true,
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

		const engine = new ClaudeCodeEngine();
		const result = await engine.execute(makeInput());

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

		const engine = new ClaudeCodeEngine();
		const result = await engine.execute(makeInput());

		expect(result.success).toBe(false);
		expect(result.error).toBe('Exceeded maximum turns');
		expect(result.cost).toBe(1.5);
	});

	it('returns human-readable error on budget exceeded', async () => {
		mockStream([
			{
				type: 'result',
				subtype: 'error_max_budget_usd',
				total_cost_usd: 0.7,
				num_turns: 5,
			},
		]);

		const engine = new ClaudeCodeEngine();
		const result = await engine.execute(makeInput({ budgetUsd: 0.18 }));

		expect(result.success).toBe(false);
		expect(result.error).toBe(
			'Budget limit reached: spent $0.70 of $0.18 allowed for this run. Increase the project work-item budget or retry with a higher limit.',
		);
		expect(result.cost).toBe(0.7);
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
		const engine = new ClaudeCodeEngine();
		await engine.execute(input);

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

		const engine = new ClaudeCodeEngine();
		const result = await engine.execute(makeInput());

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

		const engine = new ClaudeCodeEngine();
		const result = await engine.execute(makeInput());

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

		const engine = new ClaudeCodeEngine();
		const result = await engine.execute(makeInput());

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

		const engine = new ClaudeCodeEngine();
		const result = await engine.execute(makeInput());

		expect(result.success).toBe(true);
		expect(result.prUrl).toBeUndefined();
	});

	it('throws for incompatible non-Claude models', async () => {
		const engine = new ClaudeCodeEngine();
		await expect(
			engine.execute(makeInput({ model: 'openrouter:google/gemini-3-flash' })),
		).rejects.toThrow('not compatible with the Claude Code engine');
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
		const engine = new ClaudeCodeEngine();
		const result = await engine.execute(input);

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
		const engine = new ClaudeCodeEngine();
		await engine.execute(input);

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
		const engine = new ClaudeCodeEngine();
		await engine.execute(input);

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
		const engine = new ClaudeCodeEngine();
		await engine.execute(input);

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
		const engine = new ClaudeCodeEngine();
		await engine.execute(input);

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
		const engine = new ClaudeCodeEngine();
		await engine.execute(input);

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
		const engine = new ClaudeCodeEngine();
		await engine.execute(input);

		expect(input.logWriter).toHaveBeenCalledWith(
			'INFO',
			'Claude Code SDK turn completed',
			expect.objectContaining({
				success: true,
				durationMs: expect.any(Number),
				prUrl: 'https://github.com/owner/repo/pull/42',
			}),
		);
	});

	it('calls storeLlmCall per-turn when runId is provided in backendInput', async () => {
		mockStream([
			{
				type: 'assistant',
				message: {
					content: [{ type: 'text', text: 'Working on it...' }],
					usage: { input_tokens: 200, output_tokens: 80 },
				},
				uuid: 'uuid-1',
				session_id: 's1',
				parent_tool_use_id: null,
			},
			{
				type: 'result',
				subtype: 'success',
				result: 'Done',
				total_cost_usd: 0.02,
				num_turns: 1,
			},
		]);

		const input = makeInput({ runId: 'test-run-id-cc' });
		const engine = new ClaudeCodeEngine();
		await engine.execute(input);

		// Flush fire-and-forget promises
		await Promise.resolve();

		expect(mockStoreLlmCall).toHaveBeenCalledOnce();
		expect(mockStoreLlmCall).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: 'test-run-id-cc',
				callNumber: 1,
				inputTokens: 200,
				outputTokens: 80,
				// Claude Code SDK doesn't expose actual LLM call timing; durationMs is omitted
				durationMs: undefined,
			}),
		);
	});

	it('does not call storeLlmCall when runId is not provided', async () => {
		mockStream([
			{
				type: 'assistant',
				message: {
					content: [{ type: 'text', text: 'Working on it...' }],
					usage: { input_tokens: 200, output_tokens: 80 },
				},
				uuid: 'uuid-1',
				session_id: 's1',
				parent_tool_use_id: null,
			},
			{
				type: 'result',
				subtype: 'success',
				result: 'Done',
				total_cost_usd: 0.02,
				num_turns: 1,
			},
		]);

		const input = makeInput();
		// Explicitly no runId
		const engine = new ClaudeCodeEngine();
		await engine.execute(input);

		await Promise.resolve();
		expect(mockStoreLlmCall).not.toHaveBeenCalled();
	});

	it('does not call storeLlmCall when assistant message has no usage data', async () => {
		mockStream([
			{
				type: 'assistant',
				message: {
					content: [{ type: 'text', text: 'Working...' }],
					// No usage
				},
				uuid: 'uuid-1',
				session_id: 's1',
				parent_tool_use_id: null,
			},
			{
				type: 'result',
				subtype: 'success',
				result: 'Done',
				total_cost_usd: 0.0,
				num_turns: 1,
			},
		]);

		const input = makeInput({ runId: 'test-run-id-no-usage' });
		const engine = new ClaudeCodeEngine();
		await engine.execute(input);

		await Promise.resolve();
		expect(mockStoreLlmCall).not.toHaveBeenCalled();
	});
});

describe('continuation loop', () => {
	beforeEach(() => {
		mockQuery.mockReset();
	});

	function queueStream(messages: Array<{ type: string; [key: string]: unknown }>) {
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
		mockQuery.mockReturnValueOnce(asyncIterator as ReturnType<typeof query>);
	}

	it('continues session when completion check fails', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'cascade-cc-sidecar-'));
		const prSidecarPath = join(tempDir, 'pr.json');

		// First call: no sidecar written (completion check fails)
		queueStream([
			{
				type: 'result',
				subtype: 'success',
				result: 'I created a PR.',
				total_cost_usd: 0.05,
				num_turns: 3,
			},
		]);
		// Second call: sidecar written (completion check passes)
		const secondMessages = [
			{
				type: 'result',
				subtype: 'success',
				result: 'PR created for real.',
				total_cost_usd: 0.03,
				num_turns: 1,
			},
		];
		const secondIterator = secondMessages[Symbol.iterator]();
		mockQuery.mockReturnValueOnce({
			[Symbol.asyncIterator]() {
				return {
					next() {
						// Write sidecar on first next() call to simulate tool execution
						writeFileSync(
							prSidecarPath,
							JSON.stringify({
								prUrl: 'https://github.com/owner/repo/pull/42',
								source: 'cascade-tools scm create-pr',
							}),
						);
						const result = secondIterator.next();
						return Promise.resolve(result);
					},
				};
			},
		} as ReturnType<typeof query>);

		const engine = new ClaudeCodeEngine();
		const logWriter = vi.fn();
		const result = await engine.execute(
			makeInput({
				logWriter,
				completionRequirements: {
					requiresPR: true,
					prSidecarPath,
					maxContinuationTurns: 2,
				},
			}),
		);
		rmSync(tempDir, { recursive: true, force: true });

		expect(result.success).toBe(true);
		expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42');
		expect(result.prEvidence).toEqual({
			source: 'native-tool-sidecar',
			authoritative: true,
			command: 'cascade-tools scm create-pr',
		});
		expect(mockQuery).toHaveBeenCalledTimes(2);
		// Second call should have continue: true
		expect(mockQuery.mock.calls[1][0]).toEqual(
			expect.objectContaining({
				options: expect.objectContaining({ continue: true }),
			}),
		);
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'Claude Code completion check failed; continuing session',
			expect.objectContaining({
				reason: 'Agent completed but no authoritative PR creation was recorded',
				continuationTurn: 1,
				maxContinuationTurns: 2,
			}),
		);
	});

	it('fails after exhausting continuation turns', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'cascade-cc-exhaust-'));
		const prSidecarPath = join(tempDir, 'pr.json');

		// All calls succeed but never write the sidecar
		for (let i = 0; i < 3; i++) {
			queueStream([
				{
					type: 'result',
					subtype: 'success',
					result: 'Narrated PR creation.',
					total_cost_usd: 0.02,
					num_turns: 1,
				},
			]);
		}

		const engine = new ClaudeCodeEngine();
		const result = await engine.execute(
			makeInput({
				completionRequirements: {
					requiresPR: true,
					prSidecarPath,
					maxContinuationTurns: 2,
				},
			}),
		);
		rmSync(tempDir, { recursive: true, force: true });

		expect(result.success).toBe(false);
		expect(result.error).toBe('Agent completed but no authoritative PR creation was recorded');
		// Initial + 2 continuation = 3 total calls
		expect(mockQuery).toHaveBeenCalledTimes(3);
	});

	it('does not continue on non-success results', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'cascade-cc-nosuccess-'));
		const prSidecarPath = join(tempDir, 'pr.json');

		queueStream([
			{
				type: 'result',
				subtype: 'error_max_turns',
				errors: ['Exceeded maximum turns'],
				total_cost_usd: 1.5,
				num_turns: 20,
			},
		]);

		const engine = new ClaudeCodeEngine();
		const result = await engine.execute(
			makeInput({
				completionRequirements: {
					requiresPR: true,
					prSidecarPath,
					maxContinuationTurns: 2,
				},
			}),
		);
		rmSync(tempDir, { recursive: true, force: true });

		expect(result.success).toBe(false);
		expect(result.error).toBe('Exceeded maximum turns');
		// Should NOT have continued
		expect(mockQuery).toHaveBeenCalledTimes(1);
	});

	it('accumulates cost across continuation turns', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'cascade-cc-cost-'));
		const prSidecarPath = join(tempDir, 'pr.json');

		// First call: no sidecar
		queueStream([
			{
				type: 'result',
				subtype: 'success',
				result: 'Working...',
				total_cost_usd: 0.1,
				num_turns: 2,
			},
		]);
		// Second call: write sidecar
		const secondMessages = [
			{
				type: 'result',
				subtype: 'success',
				result: 'Done.',
				total_cost_usd: 0.05,
				num_turns: 1,
			},
		];
		const secondIterator = secondMessages[Symbol.iterator]();
		mockQuery.mockReturnValueOnce({
			[Symbol.asyncIterator]() {
				return {
					next() {
						writeFileSync(
							prSidecarPath,
							JSON.stringify({
								prUrl: 'https://github.com/owner/repo/pull/99',
								source: 'cascade-tools scm create-pr',
							}),
						);
						const result = secondIterator.next();
						return Promise.resolve(result);
					},
				};
			},
		} as ReturnType<typeof query>);

		const engine = new ClaudeCodeEngine();
		const result = await engine.execute(
			makeInput({
				completionRequirements: {
					requiresPR: true,
					prSidecarPath,
					maxContinuationTurns: 2,
				},
			}),
		);
		rmSync(tempDir, { recursive: true, force: true });

		expect(result.success).toBe(true);
		expect(result.cost).toBeCloseTo(0.15);
	});

	it('does not continue when no completionRequirements', async () => {
		queueStream([
			{
				type: 'result',
				subtype: 'success',
				result: 'Done.',
				total_cost_usd: 0.01,
				num_turns: 1,
			},
		]);

		const engine = new ClaudeCodeEngine();
		const result = await engine.execute(makeInput({ completionRequirements: undefined }));

		expect(result.success).toBe(true);
		expect(mockQuery).toHaveBeenCalledTimes(1);
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

	it('does not pass non-allowlisted process.env vars through', () => {
		process.env.GITHUB_TOKEN = 'global-token';

		try {
			const { env } = buildEnv();
			expect(env.GITHUB_TOKEN).toBeUndefined();
		} finally {
			unsetEnv('GITHUB_TOKEN');
		}
	});

	it('non-allowlisted vars are available via projectSecrets', () => {
		const { env } = buildEnv({ GITHUB_TOKEN: 'project-token' });
		expect(env.GITHUB_TOKEN).toBe('project-token');
	});

	it('blocks DATABASE_URL from process.env', () => {
		process.env.DATABASE_URL = 'postgres://secret@localhost/db';

		try {
			const { env } = buildEnv();
			expect(env.DATABASE_URL).toBeUndefined();
		} finally {
			unsetEnv('DATABASE_URL');
		}
	});

	it('blocks REDIS_URL from process.env', () => {
		process.env.REDIS_URL = 'redis://localhost:6379';

		try {
			const { env } = buildEnv();
			expect(env.REDIS_URL).toBeUndefined();
		} finally {
			unsetEnv('REDIS_URL');
		}
	});

	it('blocks JOB_ID, JOB_TYPE, JOB_DATA from process.env', () => {
		process.env.JOB_ID = '123';
		process.env.JOB_TYPE = 'implementation';
		process.env.JOB_DATA = '{"card":"c1"}';

		try {
			const { env } = buildEnv();
			expect(env.JOB_ID).toBeUndefined();
			expect(env.JOB_TYPE).toBeUndefined();
			expect(env.JOB_DATA).toBeUndefined();
		} finally {
			unsetEnv('JOB_ID');
			unsetEnv('JOB_TYPE');
			unsetEnv('JOB_DATA');
		}
	});

	it('blocks unknown/custom vars from process.env', () => {
		process.env.MY_CUSTOM_SECRET = 'secret-value';

		try {
			const { env } = buildEnv();
			expect(env.MY_CUSTOM_SECRET).toBeUndefined();
		} finally {
			unsetEnv('MY_CUSTOM_SECRET');
		}
	});

	it('passes through HOME and PATH from process.env', () => {
		const { env } = buildEnv();
		expect(env.HOME).toBe(process.env.HOME);
		expect(env.PATH).toBe(process.env.PATH);
	});

	it('prepends native-tool shim dir and cascade-tools bin dir to PATH', () => {
		const { env } = buildEnv(undefined, '/app/bin', '/tmp/cascade-shim');
		expect(env.PATH?.startsWith('/tmp/cascade-shim:/app/bin:')).toBe(true);
	});

	it('passes through LC_*, GIT_*, SSH_* prefixed vars', () => {
		process.env.LC_ALL = 'en_US.UTF-8';
		process.env.GIT_AUTHOR_NAME = 'Test';
		process.env.SSH_AUTH_SOCK = '/tmp/ssh.sock';

		try {
			const { env } = buildEnv();
			expect(env.LC_ALL).toBe('en_US.UTF-8');
			expect(env.GIT_AUTHOR_NAME).toBe('Test');
			expect(env.SSH_AUTH_SOCK).toBe('/tmp/ssh.sock');
		} finally {
			unsetEnv('LC_ALL');
			unsetEnv('GIT_AUTHOR_NAME');
			unsetEnv('SSH_AUTH_SOCK');
		}
	});

	it('projectSecrets override and inject correctly', () => {
		const { env } = buildEnv({
			GITHUB_TOKEN: 'proj-gh',
			TRELLO_API_KEY: 'proj-trello',
			CUSTOM_VAR: 'custom-val',
		});
		expect(env.GITHUB_TOKEN).toBe('proj-gh');
		expect(env.TRELLO_API_KEY).toBe('proj-trello');
		expect(env.CUSTOM_VAR).toBe('custom-val');
	});
});

describe('ClaudeCodeEngine lifecycle hooks', () => {
	let fakeHome: string;
	let fakeRepoDir: string;
	let originalHome: string | undefined;

	beforeEach(() => {
		fakeHome = mkdtempSync(join(tmpdir(), 'cascade-test-home-'));
		fakeRepoDir = mkdtempSync(join(tmpdir(), 'cascade-test-repo-'));
		originalHome = process.env.HOME;
		process.env.HOME = fakeHome;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		await rm(fakeHome, { recursive: true, force: true });
		await rm(fakeRepoDir, { recursive: true, force: true });
	});

	it('beforeExecute creates .claude.json onboarding flag', async () => {
		const engine = new ClaudeCodeEngine();
		const plan = makeInput({ repoDir: fakeRepoDir });
		await engine.beforeExecute(plan);

		const claudeJsonPath = join(fakeHome, '.claude.json');
		expect(existsSync(claudeJsonPath)).toBe(true);
		const content = JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
		expect(content).toEqual({ hasCompletedOnboarding: true });
	});

	it('afterExecute cleans up context directory', async () => {
		const contextDir = join(fakeRepoDir, '.cascade', 'context');
		await import('node:fs/promises').then((fs) => fs.mkdir(contextDir, { recursive: true }));
		await import('node:fs/promises').then((fs) =>
			fs.writeFile(join(contextDir, 'test.txt'), 'test content'),
		);

		const engine = new ClaudeCodeEngine();
		const plan = makeInput({ repoDir: fakeRepoDir });
		await engine.afterExecute(plan, { success: true, output: '' });

		expect(existsSync(contextDir)).toBe(false);
	});

	it('afterExecute cleans up persisted Claude session directory', async () => {
		const { homedir } = await import('node:os');
		const path = await import('node:path');
		const encodedDir = fakeRepoDir.replaceAll(path.default.sep, '-');
		const sessionDir = path.default.join(homedir(), '.claude', 'projects', encodedDir);
		await import('node:fs/promises').then((fs) => fs.mkdir(sessionDir, { recursive: true }));

		const engine = new ClaudeCodeEngine();
		const plan = makeInput({ repoDir: fakeRepoDir });
		await engine.afterExecute(plan, { success: true, output: '' });

		expect(existsSync(sessionDir)).toBe(false);
	});
});

describe('resolveClaudeCodeSettings', () => {
	it('returns defaults when no engine settings are configured', () => {
		const project = makeInput().project;
		expect(resolveClaudeCodeSettings(project)).toEqual({
			effort: 'high',
			thinking: 'adaptive',
			thinkingBudgetTokens: undefined,
		});
	});

	it('applies explicit effort modes from project engine settings', () => {
		const project = {
			...makeInput().project,
			engineSettings: { 'claude-code': { effort: 'max' } },
		} as AgentExecutionPlan['project'];
		expect(resolveClaudeCodeSettings(project)).toEqual({
			effort: 'max',
			thinking: 'adaptive',
			thinkingBudgetTokens: undefined,
		});

		const projectLow = {
			...makeInput().project,
			engineSettings: { 'claude-code': { effort: 'low' } },
		} as AgentExecutionPlan['project'];
		expect(resolveClaudeCodeSettings(projectLow).effort).toBe('low');

		const projectMedium = {
			...makeInput().project,
			engineSettings: { 'claude-code': { effort: 'medium' } },
		} as AgentExecutionPlan['project'];
		expect(resolveClaudeCodeSettings(projectMedium).effort).toBe('medium');
	});

	it('applies explicit thinking modes from project engine settings', () => {
		const projectEnabled = {
			...makeInput().project,
			engineSettings: { 'claude-code': { thinking: 'enabled' } },
		} as AgentExecutionPlan['project'];
		expect(resolveClaudeCodeSettings(projectEnabled)).toEqual({
			effort: 'high',
			thinking: 'enabled',
			thinkingBudgetTokens: undefined,
		});

		const projectDisabled = {
			...makeInput().project,
			engineSettings: { 'claude-code': { thinking: 'disabled' } },
		} as AgentExecutionPlan['project'];
		expect(resolveClaudeCodeSettings(projectDisabled).thinking).toBe('disabled');
	});

	it('applies thinkingBudgetTokens when provided', () => {
		const project = {
			...makeInput().project,
			engineSettings: { 'claude-code': { thinkingBudgetTokens: 10000 } },
		} as AgentExecutionPlan['project'];
		expect(resolveClaudeCodeSettings(project)).toEqual({
			effort: 'high',
			thinking: 'adaptive',
			thinkingBudgetTokens: 10000,
		});
	});

	it('ClaudeCodeEngine.getSettingsSchema() returns ClaudeCodeSettingsSchema', () => {
		const engine = new ClaudeCodeEngine();
		const schema = engine.getSettingsSchema();
		expect(schema).toBeDefined();
		// Verify it parses valid settings
		const result = schema.safeParse({ effort: 'high', thinking: 'adaptive' });
		expect(result.success).toBe(true);
		// Verify it rejects invalid settings
		const bad = schema.safeParse({ effort: 'ultra' });
		expect(bad.success).toBe(false);
	});
});

import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.fn();
const mockStoreLlmCall = vi.fn().mockResolvedValue(undefined);
const mockWriteProjectCredential = vi.fn<() => Promise<void>>();
const mockWriteFile = vi.fn<() => Promise<void>>();
const mockMkdir = vi.fn<() => Promise<void>>();
const mockReadFile = vi.fn<() => Promise<string>>();

vi.mock('node:child_process', () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('node:fs/promises', () => ({
	mkdir: (...args: unknown[]) => mockMkdir(...args),
	writeFile: (...args: unknown[]) => mockWriteFile(...args),
	readFile: (...args: unknown[]) => mockReadFile(...args),
}));

vi.mock('../../../src/db/repositories/credentialsRepository.js', () => ({
	writeProjectCredential: (...args: unknown[]) => mockWriteProjectCredential(...args),
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	storeLlmCall: (...args: unknown[]) => mockStoreLlmCall(...args),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import { buildEnv } from '../../../src/backends/codex/env.js';
import {
	buildArgs,
	CodexEngine,
	extractErrorMessage,
	extractTextParts,
	extractToolCall,
	extractUsage,
	resolveCodexModel,
} from '../../../src/backends/codex/index.js';
import { DEFAULT_CODEX_MODEL } from '../../../src/backends/codex/models.js';
import {
	CODEX_COMPLETION_OUTPUT_SCHEMA,
	parseCodexCompletionReport,
} from '../../../src/backends/codex/outputSchema.js';
import {
	assertHeadlessCodexSettings,
	resolveCodexSettings,
} from '../../../src/backends/codex/settings.js';
import type { AgentExecutionPlan } from '../../../src/backends/types.js';

function makeInput(overrides: Partial<AgentExecutionPlan> = {}): AgentExecutionPlan {
	return {
		agentType: 'implementation',
		project: {
			id: 'test-project',
			orgId: 'org-1',
			name: 'Test Project',
			repo: 'owner/repo',
			baseBranch: 'main',
			branchPrefix: 'feature/',
			pm: { type: 'trello' },
			trello: { boardId: 'b1', lists: {}, labels: {} },
			engineSettings: undefined,
		},
		config: {
			projects: [],
		},
		repoDir: '/tmp/repo',
		systemPrompt: 'You are an agent.',
		taskPrompt: 'Implement feature X.',
		cliToolsDir: '/usr/bin',
		availableTools: [
			{
				name: 'Finish',
				description: 'Signal completion',
				cliCommand: 'cascade-tools session finish',
				parameters: { comment: { type: 'string', required: true } },
			},
		],
		contextInjections: [],
		maxIterations: 20,
		budgetUsd: 5,
		model: DEFAULT_CODEX_MODEL,
		nativeToolCapabilities: ['fs:read', 'fs:write', 'shell:exec'],
		progressReporter: {
			onIteration: vi.fn().mockResolvedValue(undefined),
			onToolCall: vi.fn(),
			onText: vi.fn(),
		},
		logWriter: vi.fn(),
		agentInput: { workItemId: 'card-1' },
		projectSecrets: { OPENAI_API_KEY: 'sk-test' },
		engineLogPath: undefined,
		...overrides,
	};
}

function createMockChild({
	stdoutLines = [],
	stderr = '',
	exitCode = 0,
	onBeforeClose,
}: {
	stdoutLines?: string[];
	stderr?: string;
	exitCode?: number;
	onBeforeClose?: () => void;
}) {
	const child = new EventEmitter() as EventEmitter & {
		stdout: PassThrough;
		stderr: PassThrough;
		stdin: PassThrough;
	};
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.stdin = new PassThrough();

	queueMicrotask(() => {
		for (const line of stdoutLines) {
			child.stdout.write(`${line}\n`);
		}
		if (stderr) child.stderr.write(stderr);
		onBeforeClose?.();
		child.stdout.end();
		child.stderr.end();
		child.emit('close', exitCode);
	});

	return child;
}

describe('resolveCodexModel', () => {
	it('passes through known Codex models', () => {
		expect(resolveCodexModel(DEFAULT_CODEX_MODEL)).toBe(DEFAULT_CODEX_MODEL);
	});

	it('strips openai: prefix', () => {
		expect(resolveCodexModel(`openai:${DEFAULT_CODEX_MODEL}`)).toBe(DEFAULT_CODEX_MODEL);
	});

	it('passes through the GPT-5.6 Sol/Terra/Luna tiers (bare and openai:-prefixed)', () => {
		for (const id of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
			expect(resolveCodexModel(id)).toBe(id);
			expect(resolveCodexModel(`openai:${id}`)).toBe(id);
		}
	});

	it('throws for incompatible models', () => {
		expect(() => resolveCodexModel('openrouter:google/gemini-3-flash-preview')).toThrow(
			'not compatible with the Codex engine',
		);
	});

	it('throws for openai: prefix with an unlisted model (no pricing row)', () => {
		// Pins the constraint that openai:* only resolves when the bare ID is in
		// CODEX_MODEL_IDS — prevents silent zero-cost runs on models with no
		// pricing entry in MODEL_PRICING.
		expect(() => resolveCodexModel('openai:gpt-5-codex')).toThrow(
			'not compatible with the Codex engine',
		);
	});

	it('throws for gpt-*codex* pattern not in CODEX_MODEL_IDS', () => {
		// The old wildcard gpt-*codex* branch was removed; unrecognised model IDs
		// must throw rather than silently pass through with zero cost.
		expect(() => resolveCodexModel('gpt-5-turbo-codex')).toThrow(
			'not compatible with the Codex engine',
		);
	});
});

describe('extractErrorMessage', () => {
	it('extracts string error field', () => {
		expect(extractErrorMessage({ error: 'something went wrong' })).toBe('something went wrong');
	});

	it('extracts message from object error field (turn.failed shape)', () => {
		expect(
			extractErrorMessage({
				type: 'turn.failed',
				error: { message: 'unexpected status 401 Unauthorized' },
			}),
		).toBe('unexpected status 401 Unauthorized');
	});

	it('extracts message from top-level type:"error" event', () => {
		expect(extractErrorMessage({ type: 'error', message: 'Reconnecting...' })).toBe(
			'Reconnecting...',
		);
	});

	it('returns undefined when no error fields are present', () => {
		expect(extractErrorMessage({ type: 'text', text: 'hello' })).toBeUndefined();
	});

	it('returns undefined for empty string error', () => {
		expect(extractErrorMessage({ error: '' })).toBeUndefined();
	});
});

describe('extractToolCall', () => {
	it('handles tool_use event with input', () => {
		expect(extractToolCall({ type: 'tool_use', name: 'bash', input: { cmd: 'ls' } })).toEqual({
			name: 'bash',
			input: { cmd: 'ls' },
		});
	});

	it('handles tool_use event without input', () => {
		expect(extractToolCall({ type: 'tool_use', name: 'bash' })).toEqual({
			name: 'bash',
			input: undefined,
		});
	});

	it('handles original tool_name/tool_input format', () => {
		expect(extractToolCall({ tool_name: 'bash', tool_input: { cmd: 'ls' } })).toEqual({
			name: 'bash',
			input: { cmd: 'ls' },
		});
	});

	it('handles tool_call event with input', () => {
		expect(extractToolCall({ type: 'tool_call', name: 'bash', input: { cmd: 'ls' } })).toEqual({
			name: 'bash',
			input: { cmd: 'ls' },
		});
	});

	it('returns null for empty-string name in tool_use event', () => {
		expect(extractToolCall({ type: 'tool_use', name: '', input: {} })).toBeNull();
	});

	it('returns null for unrelated event type with name field', () => {
		expect(extractToolCall({ type: 'status', name: 'planner' })).toBeNull();
	});

	it('extracts function_call from item.completed event with string arguments', () => {
		expect(
			extractToolCall({
				type: 'item.completed',
				item: { type: 'function_call', name: 'bash', arguments: '{"command":"ls"}' },
			}),
		).toEqual({ name: 'bash', input: { command: 'ls' } });
	});

	it('treats command_execution item as bash tool call', () => {
		expect(
			extractToolCall({
				type: 'item.completed',
				item: { type: 'command_execution', command: 'git status', status: 'completed' },
			}),
		).toEqual({ name: 'bash', input: { command: 'git status' } });
	});

	it('extracts function_call from item.completed event with no arguments', () => {
		expect(
			extractToolCall({
				type: 'item.completed',
				item: { type: 'function_call', name: 'finish' },
			}),
		).toEqual({ name: 'finish', input: undefined });
	});

	it('returns null for item.completed event with non-function_call item type', () => {
		expect(
			extractToolCall({
				type: 'item.completed',
				item: { type: 'agent_message', text: 'Done.' },
			}),
		).toBeNull();
	});

	it('handles malformed JSON arguments in item.completed function_call (Responses API)', () => {
		expect(
			extractToolCall({
				type: 'item.completed',
				item: { type: 'function_call', name: 'bash', arguments: '{bad json here' },
			}),
		).toEqual({ name: 'bash', input: undefined });
	});

	it('handles item.completed function_call with object arguments (not string)', () => {
		expect(
			extractToolCall({
				type: 'item.completed',
				item: { type: 'function_call', name: 'Tmux', arguments: { command: 'npm test' } },
			}),
		).toEqual({ name: 'Tmux', input: { command: 'npm test' } });
	});

	it('returns null when item.completed has no item field', () => {
		expect(extractToolCall({ type: 'item.completed' })).toBeNull();
	});

	it('returns null for item.completed with null item', () => {
		expect(extractToolCall({ type: 'item.completed', item: null })).toBeNull();
	});

	it('handles tool_name without tool_input (input is undefined)', () => {
		expect(extractToolCall({ tool_name: 'bash' })).toEqual({
			name: 'bash',
			input: undefined,
		});
	});
});

describe('extractTextParts', () => {
	it('extracts text from item.completed agent_message event', () => {
		const result = extractTextParts({
			type: 'item.completed',
			item: { type: 'agent_message', text: 'Done.' },
		});
		expect(result).toContain('Done.');
	});

	it('extracts text from item.completed message event', () => {
		const result = extractTextParts({
			type: 'item.completed',
			item: { type: 'message', content: [{ type: 'text', text: 'Planning...' }] },
		});
		expect(result).toContain('Planning...');
	});

	it('extracts text from item.delta event', () => {
		const result = extractTextParts({
			type: 'item.delta',
			delta: { type: 'text_delta', text: 'Step 1:' },
		});
		expect(result).toContain('Step 1:');
	});

	it('still extracts plain string event.text (backward compat)', () => {
		const result = extractTextParts({ text: 'hello' });
		expect(result).toContain('hello');
	});

	it('still extracts plain string event.delta (backward compat)', () => {
		const result = extractTextParts({ delta: 'streamed chunk' });
		expect(result).toContain('streamed chunk');
	});
});

describe('extractUsage', () => {
	it('extracts usage from response.completed event', () => {
		const result = extractUsage({
			type: 'response.completed',
			response: { usage: { input_tokens: 100, output_tokens: 50 } },
		});
		expect(result).toEqual({
			inputTokens: 100,
			outputTokens: 50,
			cachedTokens: undefined,
			reasoningTokens: undefined,
		});
	});

	it('extracts cached_input_tokens from turn.completed usage', () => {
		const result = extractUsage({
			type: 'turn.completed',
			usage: { input_tokens: 500, output_tokens: 30, cached_input_tokens: 450 },
		});
		expect(result).toEqual({
			inputTokens: 500,
			outputTokens: 30,
			cachedTokens: 450,
			reasoningTokens: undefined,
		});
	});

	it('extracts reasoning_output_tokens from turn.completed usage', () => {
		const result = extractUsage({
			type: 'turn.completed',
			usage: { input_tokens: 100, output_tokens: 200, reasoning_output_tokens: 800 },
		});
		expect(result).toEqual({
			inputTokens: 100,
			outputTokens: 200,
			cachedTokens: undefined,
			reasoningTokens: 800,
		});
	});

	it('ignores any cost_usd-shaped fields on the event (cost is computed CASCADE-side)', () => {
		// Pins the "delete dead branches" decision — codex exec --json doesn't
		// emit cost upstream (openai/codex#17539); the engine computes cost from
		// token deltas via calculateCost, so cost fields must NOT leak through.
		const result = extractUsage({
			usage: { input_tokens: 10, output_tokens: 5 },
			total_cost_usd: 0.01,
		});
		expect(result).toEqual({
			inputTokens: 10,
			outputTokens: 5,
			cachedTokens: undefined,
			reasoningTokens: undefined,
		});
	});

	it('returns null when no usage fields are present', () => {
		expect(extractUsage({ type: 'item.started' })).toBeNull();
	});
});

describe('resolveCodexSettings', () => {
	it('defaults to danger-full-access regardless of capabilities (Docker provides isolation)', () => {
		expect(resolveCodexSettings(makeInput({ nativeToolCapabilities: [] }).project, [])).toEqual({
			approvalPolicy: 'never',
			sandboxMode: 'danger-full-access',
			webSearch: false,
			reasoningEffort: undefined,
		});
		expect(
			resolveCodexSettings(makeInput({ nativeToolCapabilities: ['fs:read'] }).project, ['fs:read']),
		).toEqual({
			approvalPolicy: 'never',
			sandboxMode: 'danger-full-access',
			webSearch: false,
			reasoningEffort: undefined,
		});
		expect(
			resolveCodexSettings(makeInput({ nativeToolCapabilities: ['fs:write'] }).project, [
				'fs:write',
			]),
		).toEqual({
			approvalPolicy: 'never',
			sandboxMode: 'danger-full-access',
			webSearch: false,
			reasoningEffort: undefined,
		});
	});

	it('applies project engineSettings', () => {
		const input = makeInput({
			project: {
				...makeInput().project,
				engineSettings: {
					codex: { approvalPolicy: 'never', sandboxMode: 'workspace-write', webSearch: true },
				},
			},
		});

		expect(resolveCodexSettings(input.project, input.nativeToolCapabilities)).toEqual({
			approvalPolicy: 'never',
			sandboxMode: 'workspace-write',
			webSearch: true,
			reasoningEffort: undefined,
		});
	});

	it('rejects interactive approval modes for headless runs', () => {
		expect(() =>
			assertHeadlessCodexSettings({
				approvalPolicy: 'on-request',
				sandboxMode: 'workspace-write',
				webSearch: false,
			}),
		).toThrow('approvalPolicy="never"');
	});
});

describe('buildArgs', () => {
	const baseSettings = {
		approvalPolicy: 'never' as const,
		sandboxMode: 'read-only' as const,
		reasoningEffort: undefined,
	};

	it('does not include -c search=true when webSearch is false', () => {
		const args = buildArgs(
			makeInput(),
			{ ...baseSettings, webSearch: false },
			'model-x',
			'/tmp/last.json',
			'/tmp/output-schema.json',
		);
		expect(args).not.toContain('--search');
		expect(args).not.toContain('search=true');
	});

	it('includes --enable web_search when webSearch is true', () => {
		const args = buildArgs(
			makeInput(),
			{ ...baseSettings, webSearch: true },
			'model-x',
			'/tmp/last.json',
			'/tmp/output-schema.json',
		);
		expect(args).toContain('--enable');
		expect(args).toContain('web_search');
	});

	it('passes the structured completion schema to codex exec', () => {
		const args = buildArgs(
			makeInput(),
			{ ...baseSettings, webSearch: false },
			'model-x',
			'/tmp/last.json',
			'/tmp/output-schema.json',
		);
		expect(args[args.indexOf('--output-schema') + 1]).toBe('/tmp/output-schema.json');
	});

	it('ignores user config and execpolicy rules for hermetic execution', () => {
		const args = buildArgs(
			makeInput(),
			{ ...baseSettings, webSearch: false },
			'model-x',
			'/tmp/last.json',
			'/tmp/output-schema.json',
		);
		expect(args).toContain('--ignore-user-config');
		expect(args).toContain('--ignore-rules');
	});
});

describe('structured completion output', () => {
	it('defines a strict schema for status, PR claim, and prose summary', () => {
		expect(CODEX_COMPLETION_OUTPUT_SCHEMA).toMatchObject({
			type: 'object',
			additionalProperties: false,
			required: ['status', 'prUrl', 'summary'],
		});
	});

	it('parses a schema-conforming report', () => {
		expect(
			parseCodexCompletionReport(
				JSON.stringify({
					status: 'completed',
					prUrl: 'https://github.com/owner/repo/pull/123',
					summary: 'Implemented and tested the change.',
				}),
			),
		).toEqual({
			status: 'completed',
			prUrl: 'https://github.com/owner/repo/pull/123',
			summary: 'Implemented and tested the change.',
		});
	});

	it('returns undefined for malformed or invalid reports', () => {
		expect(parseCodexCompletionReport('not json')).toBeUndefined();
		expect(parseCodexCompletionReport('{"status":"completed","prUrl":null}')).toBeUndefined();
	});
});

describe('buildEnv', () => {
	it('allows Codex auth variables and project secrets', () => {
		process.env.OPENAI_API_KEY = 'host-key';
		process.env.CODEX_API_KEY = 'codex-host-key';
		const env = buildEnv({ CASCADE_AGENT_TYPE: 'implementation' });
		expect(env.OPENAI_API_KEY).toBeUndefined();
		expect(env.CODEX_API_KEY).toBe('codex-host-key');
		expect(env.CASCADE_AGENT_TYPE).toBe('implementation');
	});
});

describe('CodexEngine', () => {
	let workspaceDir: string;

	beforeEach(() => {
		workspaceDir = mkdtempSync(join(tmpdir(), 'cascade-codex-test-'));
		// Default fs/promises stubs — auth tests override as needed
		mockMkdir.mockResolvedValue(undefined);
		mockWriteFile.mockResolvedValue(undefined);
		mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
		mockWriteProjectCredential.mockResolvedValue(undefined);
	});

	afterEach(() => {
		rmSync(workspaceDir, { recursive: true, force: true });
		Reflect.deleteProperty(process.env, 'OPENAI_API_KEY');
		Reflect.deleteProperty(process.env, 'CODEX_API_KEY');
	});

	it('executes codex CLI and parses JSONL activity', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [
					JSON.stringify({ type: 'turn.started' }),
					JSON.stringify({ text: 'Thinking...' }),
					JSON.stringify({
						tool_name: 'Bash',
						tool_input: { command: 'cascade-tools session finish --comment done' },
					}),
					// Intermediate usage event — accumulates into turn, does NOT persist a row
					JSON.stringify({ usage: { input_tokens: 11, output_tokens: 7 } }),
					// turn.completed finalizes and persists the accumulated turn data
					JSON.stringify({
						type: 'turn.completed',
						usage: { input_tokens: 11, output_tokens: 7 },
					}),
				],
				onBeforeClose: () => {
					writeFileSync(
						outputPath,
						'Finished work. https://github.com/owner/repo/pull/123',
						'utf-8',
					);
				},
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			engineLogPath: join(workspaceDir, 'codex.log'),
			runId: 'run-123',
		});

		const result = await engine.execute(input);

		expect(result.success).toBe(true);
		expect(result.output).toContain('Finished work.');
		expect(result.prUrl).toBe('https://github.com/owner/repo/pull/123');
		// Cost is computed CASCADE-side from tokens × pricing table; the
		// per-1M-token rate keeps the absolute number tiny for 11 in / 7 out.
		expect(result.cost).toBeGreaterThan(0);
		expect(result.cost).toBeLessThan(0.01);
		expect(input.progressReporter.onIteration).toHaveBeenCalled();
		expect(input.progressReporter.onToolCall).toHaveBeenCalledWith('Bash', {
			command: 'cascade-tools session finish --comment done',
		});
		expect(input.progressReporter.onText).toHaveBeenCalledWith('Thinking...');
		expect(mockStoreLlmCall).toHaveBeenCalled();
		expect(readFileSync(join(workspaceDir, 'codex.log'), 'utf-8')).toContain('codex');
	});

	it('uses the structured summary and treats its PR URL as non-authoritative text evidence', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			const schemaPath = args[args.indexOf('--output-schema') + 1];
			expect(JSON.parse(readFileSync(schemaPath, 'utf-8'))).toEqual(CODEX_COMPLETION_OUTPUT_SCHEMA);
			return createMockChild({
				onBeforeClose: () => {
					writeFileSync(
						outputPath,
						JSON.stringify({
							status: 'completed',
							prUrl: 'https://github.com/owner/repo/pull/456',
							summary: 'Implemented the structured completion report.',
						}),
						'utf-8',
					);
				},
			});
		});

		const input = makeInput({ repoDir: workspaceDir });
		const result = await new CodexEngine().execute(input);

		expect(result.output).toBe('Implemented the structured completion report.');
		expect(result.prUrl).toBe('https://github.com/owner/repo/pull/456');
		expect(result.prEvidence).toEqual({ source: 'text', authoritative: false });
		expect(input.logWriter).toHaveBeenCalledWith(
			'INFO',
			'Codex structured completion claimed PR creation',
			expect.objectContaining({ authoritative: false }),
		);
	});

	it('fails fast when approval policy is not automation-safe', async () => {
		const engine = new CodexEngine();
		const input = makeInput({
			project: {
				...makeInput().project,
				engineSettings: { codex: { approvalPolicy: 'on-request' } },
			},
		});

		await expect(engine.execute(input)).rejects.toThrow('approvalPolicy="never"');
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it('rejects interactive approval modes even when agent input is marked interactive', async () => {
		const engine = new CodexEngine();
		const input = makeInput({
			agentInput: { workItemId: 'card-1', interactive: true },
			project: {
				...makeInput().project,
				engineSettings: { codex: { approvalPolicy: 'untrusted' } },
			},
		});

		await expect(engine.execute(input)).rejects.toThrow('approvalPolicy="never"');
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it('surfaces turn.failed object error as finalError and logs WARN', async () => {
		mockSpawn.mockImplementation(() =>
			createMockChild({
				stdoutLines: [
					JSON.stringify({
						type: 'turn.failed',
						error: { message: 'unexpected status 401 Unauthorized' },
					}),
				],
				exitCode: 1,
			}),
		);

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir });
		const result = await engine.execute(input);

		expect(result.success).toBe(false);
		expect(result.error).toBe('unexpected status 401 Unauthorized');
		expect(input.logWriter).toHaveBeenCalledWith('WARN', 'Codex error event', {
			error: 'unexpected status 401 Unauthorized',
		});
	});

	it('parses tool_use events and calls onToolCall', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [JSON.stringify({ type: 'tool_use', name: 'bash', input: { cmd: 'ls' } })],
				onBeforeClose: () => {
					writeFileSync(outputPath, 'done', 'utf-8');
				},
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir });

		await engine.execute(input);

		expect(input.progressReporter.onToolCall).toHaveBeenCalledWith('bash', { cmd: 'ls' });
		expect(input.progressReporter.onIteration).toHaveBeenCalled();
	});

	it('emits DEBUG log for unrecognized event types', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [JSON.stringify({ type: 'thinking', content: 'Let me think...' })],
				onBeforeClose: () => {
					writeFileSync(outputPath, 'done', 'utf-8');
				},
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir });

		await engine.execute(input);

		const rawEvent = { type: 'thinking', content: 'Let me think...' };
		expect(input.logWriter).toHaveBeenCalledWith(
			'DEBUG',
			'Unrecognized Codex event type — no fields extracted',
			{ type: 'thinking', item: null, delta: null, event: rawEvent },
		);
	});

	it('logs full event payload including item and delta on unrecognized events', async () => {
		const unknownEvent = {
			type: 'some.future.event',
			metadata: { id: 'rs_001' },
		};
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [JSON.stringify(unknownEvent)],
				onBeforeClose: () => writeFileSync(outputPath, 'done', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir });
		await engine.execute(input);

		expect(input.logWriter).toHaveBeenCalledWith(
			'DEBUG',
			'Unrecognized Codex event type — no fields extracted',
			expect.objectContaining({ type: 'some.future.event' }),
		);
	});

	it('logs a clean debug message for item.started events (not "unrecognized")', async () => {
		const itemStartedEvent = {
			type: 'item.started',
			item: { type: 'command_execution', id: 'item_1' },
		};
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [JSON.stringify(itemStartedEvent)],
				onBeforeClose: () => writeFileSync(outputPath, 'done', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir });
		await engine.execute(input);

		expect(input.logWriter).toHaveBeenCalledWith('DEBUG', 'Codex item started', {
			itemType: 'command_execution',
		});
		expect(input.logWriter).not.toHaveBeenCalledWith(
			'DEBUG',
			'Unrecognized Codex event type — no fields extracted',
			expect.anything(),
		);
	});

	it('increments iterationCount on turn.completed and passes usage to storeLlmCall', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [
					JSON.stringify({
						type: 'turn.completed',
						usage: { input_tokens: 200, output_tokens: 80, cached_input_tokens: 150 },
					}),
				],
				onBeforeClose: () => writeFileSync(outputPath, 'done', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir, runId: 'run-turn-completed' });
		await engine.execute(input);

		expect(input.progressReporter.onIteration).toHaveBeenCalledTimes(1);
		expect(mockStoreLlmCall).toHaveBeenCalledWith(
			expect.objectContaining({ inputTokens: 200, outputTokens: 80, cachedTokens: 150 }),
		);
		expect(input.logWriter).not.toHaveBeenCalledWith(
			'DEBUG',
			'Unrecognized Codex event type — no fields extracted',
			expect.anything(),
		);
	});

	it('silently ignores turn.started and thread.started without logging unrecognized', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [
					JSON.stringify({ type: 'thread.started', thread_id: 'th_abc' }),
					JSON.stringify({ type: 'turn.started' }),
				],
				onBeforeClose: () => writeFileSync(outputPath, 'done', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir });
		await engine.execute(input);

		expect(input.progressReporter.onIteration).not.toHaveBeenCalled();
		expect(input.logWriter).not.toHaveBeenCalledWith(
			'DEBUG',
			'Unrecognized Codex event type — no fields extracted',
			expect.anything(),
		);
	});

	it('extracts text from agent_message items and calls onText', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [
					JSON.stringify({
						type: 'item.completed',
						item: { type: 'agent_message', text: 'Here is my plan.' },
					}),
				],
				onBeforeClose: () => writeFileSync(outputPath, 'done', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir });
		await engine.execute(input);

		expect(input.progressReporter.onText).toHaveBeenCalledWith('Here is my plan.');
		expect(input.progressReporter.onIteration).toHaveBeenCalledTimes(1);
	});

	it('treats command_execution items as bash tool calls', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [
					JSON.stringify({
						type: 'item.completed',
						item: {
							type: 'command_execution',
							command: 'ls -la',
							status: 'completed',
							exit_code: 0,
						},
					}),
				],
				onBeforeClose: () => writeFileSync(outputPath, 'done', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir });
		await engine.execute(input);

		expect(input.progressReporter.onToolCall).toHaveBeenCalledWith('bash', { command: 'ls -la' });
		expect(input.progressReporter.onIteration).toHaveBeenCalledTimes(1);
	});

	it('logs tool calls at DEBUG level when a function_call item is completed', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [
					JSON.stringify({
						type: 'item.completed',
						item: {
							type: 'function_call',
							name: 'bash',
							arguments: '{"command":"echo hello"}',
						},
					}),
				],
				onBeforeClose: () => writeFileSync(outputPath, 'done', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir });
		await engine.execute(input);

		expect(input.logWriter).toHaveBeenCalledWith('DEBUG', 'Codex tool call', {
			name: 'bash',
			input: { command: 'echo hello' },
		});
	});

	it('logs usage at DEBUG level when a response.completed event is received', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [
					JSON.stringify({
						type: 'response.completed',
						response: { usage: { input_tokens: 42, output_tokens: 7 } },
					}),
				],
				onBeforeClose: () => writeFileSync(outputPath, 'done', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir, runId: 'run-usage-debug' });
		await engine.execute(input);

		expect(input.logWriter).toHaveBeenCalledWith(
			'DEBUG',
			'Codex usage',
			expect.objectContaining({
				usage: expect.objectContaining({ inputTokens: 42, outputTokens: 7 }),
			}),
		);
	});

	it('logs stderr in real-time via logWriter', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [],
				stderr: 'fatal: something went wrong\n',
				onBeforeClose: () => writeFileSync(outputPath, 'done', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir });
		await engine.execute(input);

		expect(input.logWriter).toHaveBeenCalledWith('DEBUG', 'Codex stderr', {
			stderr: 'fatal: something went wrong',
		});
	});

	it('logs process exit details at DEBUG level', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [],
				onBeforeClose: () => writeFileSync(outputPath, 'finished', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir });
		await engine.execute(input);

		expect(input.logWriter).toHaveBeenCalledWith(
			'DEBUG',
			'Codex process exited',
			expect.objectContaining({ exitCode: 0, iterationCount: 0, llmCallCount: 0 }),
		);
	});

	it('counts iterations and detects tool calls from item.completed events (Responses API format)', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [
					JSON.stringify({ type: 'turn.started' }),
					JSON.stringify({
						type: 'item.completed',
						item: { type: 'message', content: [{ type: 'text', text: 'Planning...' }] },
					}),
					JSON.stringify({
						type: 'item.completed',
						item: {
							type: 'function_call',
							name: 'bash',
							arguments: '{"command":"cascade-tools session finish --comment done"}',
						},
					}),
					// response.completed carries usage — accumulates into turn, does NOT persist a row yet
					JSON.stringify({
						type: 'response.completed',
						response: { usage: { input_tokens: 100, output_tokens: 50 } },
					}),
					// turn.completed is the persistence boundary — one row per completed turn
					JSON.stringify({
						type: 'turn.completed',
						usage: { input_tokens: 100, output_tokens: 50 },
					}),
				],
				onBeforeClose: () => {
					writeFileSync(outputPath, 'Planning complete.', 'utf-8');
				},
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir, runId: 'run-responses-api' });

		const result = await engine.execute(input);

		expect(result.success).toBe(true);
		// 2 item.completed events increment iteration + 1 turn.completed = 3 total
		expect(input.progressReporter.onIteration).toHaveBeenCalledTimes(3);
		expect(input.progressReporter.onText).toHaveBeenCalledWith('Planning...');
		expect(input.progressReporter.onToolCall).toHaveBeenCalledWith('bash', {
			command: 'cascade-tools session finish --comment done',
		});
		// Two realtime per-item rows (text + tool) + one turn.completed cost row.
		expect(mockStoreLlmCall).toHaveBeenCalledTimes(3);
		// The cost row carries the turn usage.
		expect(mockStoreLlmCall).toHaveBeenCalledWith(
			expect.objectContaining({ inputTokens: 100, outputTokens: 50 }),
		);
	});

	it('ignores non-tool events that happen to contain a name field', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [
					JSON.stringify({ type: 'status', name: 'planner' }),
					JSON.stringify({
						message: { content: [{ type: 'text', text: 'Final answer.' }] },
					}),
				],
				onBeforeClose: () => {
					writeFileSync(outputPath, 'Final answer.', 'utf-8');
				},
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			runId: 'run-124',
		});

		const result = await engine.execute(input);

		expect(result.success).toBe(true);
		expect(input.progressReporter.onToolCall).not.toHaveBeenCalled();
		expect(input.progressReporter.onText).toHaveBeenCalledWith('Final answer.');
		expect(input.progressReporter.onIteration).toHaveBeenCalledTimes(1);
	});

	// ─── Turn-scoped accumulator / multi-turn / dedup tests ───────────────────

	it('emits exactly one storeLlmCall row per completed turn across a multi-turn stream', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [
					// Turn 1
					JSON.stringify({ type: 'turn.started' }),
					JSON.stringify({
						type: 'item.completed',
						item: { type: 'agent_message', text: 'First.' },
					}),
					JSON.stringify({
						type: 'response.completed',
						response: { usage: { input_tokens: 50, output_tokens: 20 } },
					}),
					JSON.stringify({
						type: 'turn.completed',
						usage: { input_tokens: 50, output_tokens: 20 },
					}),
					// Turn 2
					JSON.stringify({ type: 'turn.started' }),
					JSON.stringify({
						type: 'item.completed',
						item: { type: 'agent_message', text: 'Second.' },
					}),
					JSON.stringify({
						type: 'response.completed',
						response: { usage: { input_tokens: 80, output_tokens: 30 } },
					}),
					JSON.stringify({
						type: 'turn.completed',
						usage: { input_tokens: 80, output_tokens: 30 },
					}),
				],
				onBeforeClose: () => writeFileSync(outputPath, 'Multi-turn done.', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir, runId: 'run-multiturn' });
		const result = await engine.execute(input);

		expect(result.success).toBe(true);
		// Two realtime text rows (one per agent_message) interleaved with two
		// turn.completed cost rows = 4 rows total.
		expect(mockStoreLlmCall).toHaveBeenCalledTimes(4);
		// Row 1 = 'First.' text row — a content-block array, no tokens.
		const firstTextRow = mockStoreLlmCall.mock.calls[0][0] as {
			response: string;
			inputTokens?: number;
		};
		expect(firstTextRow.inputTokens).toBeUndefined();
		expect(JSON.parse(firstTextRow.response)).toEqual([{ type: 'text', text: 'First.' }]);
		// Codex emits CUMULATIVE session usage; the cost rows store per-turn DELTAS.
		// Feeding cumulative {50,20} then {80,30} → deltas {50,20} and {30,10}.
		// Row 2 = turn-1 cost row; row 4 = turn-2 cost row.
		expect(mockStoreLlmCall).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ callNumber: 2, inputTokens: 50, outputTokens: 20 }),
		);
		expect(mockStoreLlmCall).toHaveBeenNthCalledWith(
			4,
			expect.objectContaining({ callNumber: 4, inputTokens: 30, outputTokens: 10 }),
		);
	});

	it('stores only one row when both response.completed and turn.completed carry usage (duplicate-usage prevention)', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [
					JSON.stringify({ type: 'turn.started' }),
					// response.completed fires with usage first (intermediate event)
					JSON.stringify({
						type: 'response.completed',
						response: { usage: { input_tokens: 100, output_tokens: 40 } },
					}),
					// turn.completed fires with aggregate usage (the definitive values)
					JSON.stringify({
						type: 'turn.completed',
						usage: { input_tokens: 120, output_tokens: 45 },
					}),
				],
				onBeforeClose: () => writeFileSync(outputPath, 'done', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir, runId: 'run-dedup' });
		await engine.execute(input);

		// Only ONE row, not two (no duplicate from response.completed)
		expect(mockStoreLlmCall).toHaveBeenCalledTimes(1);
		// turn.completed totals supersede response.completed values
		expect(mockStoreLlmCall).toHaveBeenCalledWith(
			expect.objectContaining({ inputTokens: 120, outputTokens: 45 }),
		);
	});

	it('streams per-item rows (text + tool with input) and a compact turn cost row', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [
					JSON.stringify({ type: 'turn.started' }),
					JSON.stringify({
						type: 'item.completed',
						item: { type: 'agent_message', text: 'I will run a command.' },
					}),
					JSON.stringify({
						type: 'item.completed',
						item: { type: 'function_call', name: 'bash', arguments: '{"command":"ls"}' },
					}),
					JSON.stringify({
						type: 'turn.completed',
						usage: { input_tokens: 30, output_tokens: 10 },
					}),
				],
				onBeforeClose: () => writeFileSync(outputPath, 'done', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir, runId: 'run-payload-shape' });
		await engine.execute(input);

		// 1 text row + 1 tool row + 1 turn.completed cost row.
		expect(mockStoreLlmCall).toHaveBeenCalledTimes(3);
		const calls = mockStoreLlmCall.mock.calls as Array<
			[{ response: string; inputTokens?: number }]
		>;
		// Row 1: the agent message as a content-block array (renders via the shared parser).
		expect(JSON.parse(calls[0][0].response)).toEqual([
			{ type: 'text', text: 'I will run a command.' },
		]);
		// Row 2: the tool call keeps its full input, normalized to the Claude tool vocab.
		expect(JSON.parse(calls[1][0].response)).toEqual([
			{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
		]);
		expect(calls[1][0].inputTokens).toBeUndefined();
		// Row 3: the compact turn cost row — carries usage/delta, no tool-name dump.
		const costPayload = JSON.parse(calls[2][0].response) as Record<string, unknown>;
		expect(costPayload).toMatchObject({ turn: 3, usage: { inputTokens: 30, outputTokens: 10 } });
		expect(costPayload.tools).toBeUndefined();
		expect(calls[2][0].response.length).toBeLessThan(2000);
	});

	it('normalizes function_call names and persists only on item.completed (not deltas)', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [
					JSON.stringify({ type: 'turn.started' }),
					// A streaming text delta must NOT persist a row (only completed items do).
					JSON.stringify({ type: 'item.delta', delta: { type: 'text_delta', text: 'thinking…' } }),
					// A completed function_call read_file → normalized to Read, input preserved.
					JSON.stringify({
						type: 'item.completed',
						item: {
							type: 'function_call',
							name: 'read_file',
							arguments: '{"file_path":"src/a.ts"}',
						},
					}),
					JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 2 } }),
				],
				onBeforeClose: () => writeFileSync(outputPath, 'done', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		await engine.execute(makeInput({ repoDir: workspaceDir, runId: 'run-normalize' }));

		// The delta did not persist; one tool row + one cost row = 2.
		expect(mockStoreLlmCall).toHaveBeenCalledTimes(2);
		const toolResponse = (mockStoreLlmCall.mock.calls[0][0] as { response: string }).response;
		expect(JSON.parse(toolResponse)).toEqual([
			{ type: 'tool_use', name: 'Read', input: { file_path: 'src/a.ts' } },
		]);
	});

	it('does not call storeLlmCall when no turn.completed event fires (no response events only)', async () => {
		mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
			const outputPath = args[args.indexOf('-o') + 1];
			return createMockChild({
				stdoutLines: [JSON.stringify({ text: 'Bare text without turn lifecycle events' })],
				onBeforeClose: () => writeFileSync(outputPath, 'bare output', 'utf-8'),
			});
		});

		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir, runId: 'run-no-turn-completed' });
		await engine.execute(input);

		// Without turn.completed, nothing should be persisted — avoids phantom rows
		expect(mockStoreLlmCall).not.toHaveBeenCalled();
	});
});

describe('Codex subscription auth', () => {
	const AUTH_JSON = JSON.stringify({ accessToken: 'tok_abc', refreshToken: 'ref_xyz' });

	let workspaceDir: string;

	beforeEach(() => {
		workspaceDir = mkdtempSync(join(tmpdir(), 'cascade-codex-auth-test-'));
		mockMkdir.mockResolvedValue(undefined);
		mockWriteFile.mockResolvedValue(undefined);
		mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
		mockWriteProjectCredential.mockResolvedValue(undefined);
		mockSpawn.mockImplementation(() => createMockChild({ exitCode: 0 }));
	});

	afterEach(() => {
		rmSync(workspaceDir, { recursive: true, force: true });
	});

	it('writes auth.json when CODEX_AUTH_JSON is present in projectSecrets', async () => {
		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { OPENAI_API_KEY: 'sk-test', CODEX_AUTH_JSON: AUTH_JSON },
		});

		await engine.execute(input);

		expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('auth.json'), AUTH_JSON, {
			mode: 0o600,
		});
	});

	it('does not pass CODEX_AUTH_JSON to the subprocess environment', async () => {
		let capturedEnv: Record<string, string | undefined> | undefined;
		mockSpawn.mockImplementation(
			(_cmd: string, _args: string[], options: { env?: Record<string, string | undefined> }) => {
				capturedEnv = options.env;
				return createMockChild({ exitCode: 0 });
			},
		);

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { OPENAI_API_KEY: 'sk-test', CODEX_AUTH_JSON: AUTH_JSON },
		});

		await engine.execute(input);

		expect(capturedEnv?.CODEX_AUTH_JSON).toBeUndefined();
		expect(capturedEnv?.OPENAI_API_KEY).toBeUndefined();
		expect(capturedEnv?.CODEX_API_KEY).toBeUndefined();
	});

	it('writes refreshed token to project_credentials when auth.json is updated by Codex CLI', async () => {
		const refreshedJson = JSON.stringify({ accessToken: 'tok_NEW', refreshToken: 'ref_xyz' });
		mockReadFile.mockResolvedValue(refreshedJson);

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { CODEX_AUTH_JSON: AUTH_JSON },
		});

		await engine.execute(input);

		expect(mockWriteProjectCredential).toHaveBeenCalledWith(
			'test-project',
			'CODEX_AUTH_JSON',
			refreshedJson,
		);
	});

	it('skips project credential update when auth.json is unchanged after run', async () => {
		mockReadFile.mockResolvedValue(AUTH_JSON);

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { CODEX_AUTH_JSON: AUTH_JSON },
		});

		await engine.execute(input);

		expect(mockWriteProjectCredential).not.toHaveBeenCalled();
	});

	it('logs WARN and does not throw when writeProjectCredential fails during token refresh', async () => {
		const refreshedJson = JSON.stringify({ accessToken: 'tok_NEW', refreshToken: 'ref_xyz' });
		mockReadFile.mockResolvedValue(refreshedJson);
		mockWriteProjectCredential.mockRejectedValue(new Error('DB write failed'));

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { CODEX_AUTH_JSON: AUTH_JSON },
		});

		await expect(engine.execute(input)).resolves.not.toThrow();
		expect(input.logWriter).toHaveBeenCalledWith(
			'WARN',
			'Failed to capture refreshed Codex auth token',
			{ error: 'Error: DB write failed' },
		);
	});

	// --- Bare OpenAI API key auth (single-run CODEX_API_KEY) ---
	const API_KEY = 'sk-proj-test-key-123';

	it('injects CODEX_API_KEY without writing auth.json when CODEX_AUTH_JSON is absent', async () => {
		let capturedEnv: Record<string, string | undefined> | undefined;
		mockSpawn.mockImplementation(
			(_cmd: string, _args: string[], options: { env?: Record<string, string | undefined> }) => {
				capturedEnv = options.env;
				return createMockChild({ exitCode: 0 });
			},
		);
		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { OPENAI_API_KEY: API_KEY },
		});

		await engine.execute(input);

		expect(mockWriteFile).not.toHaveBeenCalledWith(
			expect.stringContaining('auth.json'),
			expect.anything(),
			expect.anything(),
		);
		expect(capturedEnv?.OPENAI_API_KEY).toBeUndefined();
		expect(capturedEnv?.CODEX_API_KEY).toBe(API_KEY);
	});

	it('never persists API-key auth back into CODEX_AUTH_JSON', async () => {
		mockReadFile.mockResolvedValue(
			JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-rotated' }),
		);

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { OPENAI_API_KEY: API_KEY },
		});

		await engine.execute(input);

		expect(mockWriteProjectCredential).not.toHaveBeenCalled();
	});

	it('prefers CODEX_AUTH_JSON over OPENAI_API_KEY when both are set', async () => {
		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { OPENAI_API_KEY: API_KEY, CODEX_AUTH_JSON: AUTH_JSON },
		});

		await engine.execute(input);

		expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('auth.json'), AUTH_JSON, {
			mode: 0o600,
		});
	});

	it('writes no auth.json when neither CODEX_AUTH_JSON nor OPENAI_API_KEY is set', async () => {
		const engine = new CodexEngine();
		const input = makeInput({ repoDir: workspaceDir, projectSecrets: {} });

		await engine.execute(input);

		expect(mockWriteFile).not.toHaveBeenCalledWith(
			expect.stringContaining('auth.json'),
			expect.anything(),
			expect.anything(),
		);
	});

	it('falls back to CODEX_API_KEY when CODEX_AUTH_JSON is invalid JSON', async () => {
		let capturedEnv: Record<string, string | undefined> | undefined;
		mockSpawn.mockImplementation(
			(_cmd: string, _args: string[], options: { env?: Record<string, string | undefined> }) => {
				capturedEnv = options.env;
				return createMockChild({ exitCode: 0 });
			},
		);
		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { OPENAI_API_KEY: API_KEY, CODEX_AUTH_JSON: 'sk-proj-not-json' },
		});

		await engine.execute(input);

		expect(mockWriteFile).not.toHaveBeenCalledWith(
			expect.stringContaining('auth.json'),
			expect.anything(),
			expect.anything(),
		);
		expect(capturedEnv?.CODEX_API_KEY).toBe(API_KEY);
		expect(input.logWriter).toHaveBeenCalledWith(
			'WARN',
			expect.stringContaining('not valid JSON'),
			{},
		);
	});

	it('never logs the API key in the clear', async () => {
		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { OPENAI_API_KEY: API_KEY },
		});

		await engine.execute(input);

		for (const call of (input.logWriter as ReturnType<typeof vi.fn>).mock.calls) {
			expect(JSON.stringify(call)).not.toContain(API_KEY);
		}
	});

	// Prod regression 2026-05-09 (runs 8b000cd6 + d8e31665, both
	// cascade/implementation/codex): codex's persistent bash session breaks
	// with `ERROR codex_core::tools::router: error=write_stdin failed: stdin
	// is closed for this session`. Once that signal fires, every subsequent
	// command in the session inherits a corrupted stdout buffer (lint output
	// from one command bleeding into the next, sidecar writes racing).
	//
	// Originally we failed the run on ANY occurrence of this signal. That
	// turned out to over-correct: the signal can fire LATE (at session-close,
	// after all real work was captured). MNG-718 (run f801342b, 2026-05-11)
	// opened a valid PR #1350 and ran a full verification suite, then was
	// marked failed because the signal fired during cleanup. The fix below
	// splits the two cases: late signal with success evidence (prUrl +
	// finalOutput) → WARN + success; early signal with no evidence → fail.
	describe('shell-state corruption (write_stdin closed)', () => {
		// EARLY-corruption variant: signal fires mid-work, no PR URL extracted,
		// no meaningful finalOutput. The corruption likely masked the agent's
		// real work, so we must fail loudly. Note the empty finalOutput — that's
		// the discriminator from the late-corruption path below.
		it('marks the run as failed when the signal fires with no success evidence (no PR URL, no output)', async () => {
			mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
				const outputPath = args[args.indexOf('-o') + 1];
				return createMockChild({
					stdoutLines: [
						JSON.stringify({ type: 'turn.started' }),
						JSON.stringify({
							type: 'turn.completed',
							usage: { input_tokens: 5, output_tokens: 3 },
						}),
					],
					stderr:
						'2026-05-09T15:36:59.079680Z ERROR codex_core::tools::router: error=write_stdin failed: stdin is closed for this session; rerun exec_command with tty=true to keep stdin open\n',
					onBeforeClose: () => {
						// No PR URL, no meaningful output — this is the early-corruption case.
						writeFileSync(outputPath, '', 'utf-8');
					},
					exitCode: 0, // <-- exit code 0 — codex itself doesn't fail; the shell-state signal is the only evidence
				});
			});

			const engine = new CodexEngine();
			const input = makeInput({ repoDir: workspaceDir });
			const result = await engine.execute(input);

			expect(result.success).toBe(false);
			expect(result.error).toMatch(/codex shell-state corrupted/i);
			expect(input.logWriter).toHaveBeenCalledWith(
				'ERROR',
				expect.stringContaining('shell-state corrupted'),
				expect.objectContaining({
					stderr: expect.stringContaining('write_stdin failed'),
				}),
			);
		});

		// LATE-corruption regression net: MNG-718 (run f801342b-1129-4502-a4b0-
		// b7808e9b2a2e, project=cascade, 2026-05-11). The agent opened PR #1350
		// AND ran a full verification suite AND filed a follow-up friction
		// ticket — all of which made it into finalOutput. The corruption signal
		// fired during/after session close. Marking the run failed cost cascade
		// the post-completion review dispatch and surfaced a misleading
		// "agent failed" comment via aaight42. The fix preserves success when
		// the evidence is real.
		it('treats late-arriving signal as success-with-warning when a PR URL was extracted (MNG-718 regression)', async () => {
			mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
				const outputPath = args[args.indexOf('-o') + 1];
				return createMockChild({
					stdoutLines: [
						JSON.stringify({ type: 'turn.started' }),
						JSON.stringify({
							type: 'turn.completed',
							usage: { input_tokens: 5, output_tokens: 3 },
						}),
					],
					stderr:
						'2026-05-11T19:21:55.000000Z ERROR codex_core::tools::router: error=write_stdin failed: stdin is closed for this session; rerun exec_command with tty=true to keep stdin open\n',
					onBeforeClose: () => {
						// PR URL extracted + non-empty final output = real work was captured
						// before the signal fired.
						writeFileSync(
							outputPath,
							'PR https://github.com/o/r/pull/1 created. Verification passed.',
							'utf-8',
						);
					},
					exitCode: 0,
				});
			});

			const engine = new CodexEngine();
			const input = makeInput({ repoDir: workspaceDir });
			const result = await engine.execute(input);

			// Despite the signal, success evidence was captured before the corruption.
			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
			expect(result.prUrl).toBe('https://github.com/o/r/pull/1');
			// And we logged loudly so operators can spot-check the PR.
			expect(input.logWriter).toHaveBeenCalledWith(
				'WARN',
				expect.stringContaining('success-with-warning'),
				expect.objectContaining({
					prUrl: 'https://github.com/o/r/pull/1',
				}),
			);
		});

		it('passes through cleanly when stderr is benign (no false positives)', async () => {
			mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
				const outputPath = args[args.indexOf('-o') + 1];
				return createMockChild({
					stdoutLines: [
						JSON.stringify({ type: 'turn.started' }),
						JSON.stringify({
							type: 'turn.completed',
							usage: { input_tokens: 5, output_tokens: 3 },
						}),
					],
					stderr: 'some benign warning that is not the shell-state signal\n',
					onBeforeClose: () => {
						writeFileSync(outputPath, 'Finished. https://github.com/o/r/pull/1', 'utf-8');
					},
					exitCode: 0,
				});
			});

			const engine = new CodexEngine();
			const input = makeInput({ repoDir: workspaceDir });
			const result = await engine.execute(input);

			expect(result.success).toBe(true);
			expect(result.error).toBeUndefined();
		});
	});
});

describe('CodexEngine lifecycle hooks', () => {
	const AUTH_JSON = JSON.stringify({ accessToken: 'tok_abc', refreshToken: 'ref_xyz' });

	let workspaceDir: string;

	beforeEach(() => {
		workspaceDir = mkdtempSync(join(tmpdir(), 'cascade-codex-lifecycle-test-'));
		mockMkdir.mockResolvedValue(undefined);
		mockWriteFile.mockResolvedValue(undefined);
		mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
		mockWriteProjectCredential.mockResolvedValue(undefined);
		mockSpawn.mockImplementation(() => createMockChild({ exitCode: 0 }));
	});

	afterEach(() => {
		rmSync(workspaceDir, { recursive: true, force: true });
	});

	it('beforeExecute writes auth.json when CODEX_AUTH_JSON is in projectSecrets', async () => {
		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { CODEX_AUTH_JSON: AUTH_JSON },
		});

		await engine.beforeExecute(input);

		expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('auth.json'), AUTH_JSON, {
			mode: 0o600,
		});
	});

	it('afterExecute writes refreshed token to project_credentials', async () => {
		const refreshedJson = JSON.stringify({ accessToken: 'tok_NEW', refreshToken: 'ref_xyz' });
		mockReadFile.mockResolvedValue(refreshedJson);

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { CODEX_AUTH_JSON: AUTH_JSON },
		});

		// Simulate adapter lifecycle: beforeExecute stores originalAuthJson, afterExecute compares
		await engine.beforeExecute(input);
		await engine.afterExecute(input, { success: true, output: '' });

		expect(mockWriteProjectCredential).toHaveBeenCalledWith(
			'test-project',
			'CODEX_AUTH_JSON',
			refreshedJson,
		);
	});

	it('afterExecute completes without throwing', async () => {
		const engine = new CodexEngine();
		const plan = makeInput({ repoDir: workspaceDir });

		await expect(engine.afterExecute(plan, { success: true, output: '' })).resolves.not.toThrow();
	});

	it('adapter lifecycle: execute does not double-capture token when adapter calls afterExecute', async () => {
		const refreshedJson = JSON.stringify({ accessToken: 'tok_NEW', refreshToken: 'ref_xyz' });
		mockReadFile.mockResolvedValue(refreshedJson);

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { CODEX_AUTH_JSON: AUTH_JSON },
		});

		// Simulate adapter: beforeExecute → execute → afterExecute
		await engine.beforeExecute(input);
		await engine.execute(input);
		await engine.afterExecute(input, { success: true, output: '' });

		// writeProjectCredential should be called exactly once (from afterExecute, not from execute's finally)
		expect(mockWriteProjectCredential).toHaveBeenCalledTimes(1);
	});
});

import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.fn();
const mockStoreLlmCall = vi.fn().mockResolvedValue(undefined);
const mockFindCredentialIdByEnvVarKey = vi.fn<() => Promise<number | null>>();
const mockUpdateCredential = vi.fn<() => Promise<void>>();
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
	findCredentialIdByEnvVarKey: (...args: unknown[]) => mockFindCredentialIdByEnvVarKey(...args),
	updateCredential: (...args: unknown[]) => mockUpdateCredential(...args),
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
	CodexEngine,
	buildArgs,
	extractErrorMessage,
	extractTextParts,
	extractToolCall,
	extractUsage,
	resolveCodexModel,
} from '../../../src/backends/codex/index.js';
import { DEFAULT_CODEX_MODEL } from '../../../src/backends/codex/models.js';
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

	it('throws for incompatible models', () => {
		expect(() => resolveCodexModel('openrouter:google/gemini-3-flash-preview')).toThrow(
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
			costUsd: undefined,
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
			costUsd: undefined,
		});
	});

	it('still extracts top-level usage field (backward compat)', () => {
		const result = extractUsage({
			usage: { input_tokens: 10, output_tokens: 5 },
			total_cost_usd: 0.01,
		});
		expect(result).toEqual({
			inputTokens: 10,
			outputTokens: 5,
			cachedTokens: undefined,
			costUsd: 0.01,
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
		);
		expect(args).toContain('--enable');
		expect(args).toContain('web_search');
	});
});

describe('buildEnv', () => {
	it('passes through OPENAI_API_KEY and project secrets', () => {
		process.env.OPENAI_API_KEY = 'host-key';
		const env = buildEnv({ CASCADE_AGENT_TYPE: 'implementation' });
		expect(env.OPENAI_API_KEY).toBe('host-key');
		expect(env.CASCADE_AGENT_TYPE).toBe('implementation');
	});
});

describe('CodexEngine', () => {
	let workspaceDir: string;

	beforeEach(() => {
		workspaceDir = mkdtempSync(join(tmpdir(), 'cascade-codex-test-'));
		vi.clearAllMocks();
		// Default fs/promises stubs — auth tests override as needed
		mockMkdir.mockResolvedValue(undefined);
		mockWriteFile.mockResolvedValue(undefined);
		mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
		mockFindCredentialIdByEnvVarKey.mockResolvedValue(null);
		mockUpdateCredential.mockResolvedValue(undefined);
	});

	afterEach(() => {
		rmSync(workspaceDir, { recursive: true, force: true });
		Reflect.deleteProperty(process.env, 'OPENAI_API_KEY');
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
					JSON.stringify({
						usage: { input_tokens: 11, output_tokens: 7 },
						total_cost_usd: 0.42,
					}),
					// turn.completed finalizes and persists the accumulated turn data
					JSON.stringify({
						type: 'turn.completed',
						usage: { input_tokens: 11, output_tokens: 7 },
						total_cost_usd: 0.42,
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
		expect(result.cost).toBe(0.42);
		expect(input.progressReporter.onIteration).toHaveBeenCalled();
		expect(input.progressReporter.onToolCall).toHaveBeenCalledWith('Bash', {
			command: 'cascade-tools session finish --comment done',
		});
		expect(input.progressReporter.onText).toHaveBeenCalledWith('Thinking...');
		expect(mockStoreLlmCall).toHaveBeenCalled();
		expect(readFileSync(join(workspaceDir, 'codex.log'), 'utf-8')).toContain('codex');
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
		// Exactly ONE storeLlmCall row per completed turn
		expect(mockStoreLlmCall).toHaveBeenCalledTimes(1);
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
		// Exactly two rows — one per completed turn
		expect(mockStoreLlmCall).toHaveBeenCalledTimes(2);
		// Stable, sequential callNumber values
		expect(mockStoreLlmCall).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ callNumber: 1, inputTokens: 50, outputTokens: 20 }),
		);
		expect(mockStoreLlmCall).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ callNumber: 2, inputTokens: 80, outputTokens: 30 }),
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

	it('stores a compact turn-scoped payload with text summary and tool names', async () => {
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

		expect(mockStoreLlmCall).toHaveBeenCalledTimes(1);
		const [{ response }] = mockStoreLlmCall.mock.calls[0] as [{ response: string }][];
		const payload = JSON.parse(response) as Record<string, unknown>;
		// Payload must be a compact object, NOT a raw JSONL line dump
		expect(payload).toMatchObject({
			turn: 1,
			tools: ['bash'],
			usage: { inputTokens: 30, outputTokens: 10 },
		});
		expect(typeof payload.text).toBe('string');
		// Payload must be reasonably sized (< 2 KB) — not a multi-KB raw event dump
		expect(response.length).toBeLessThan(2000);
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
		vi.clearAllMocks();
		mockMkdir.mockResolvedValue(undefined);
		mockWriteFile.mockResolvedValue(undefined);
		mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
		mockFindCredentialIdByEnvVarKey.mockResolvedValue(null);
		mockUpdateCredential.mockResolvedValue(undefined);
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
		expect(capturedEnv?.OPENAI_API_KEY).toBe('sk-test');
	});

	it('updates the DB credential when auth.json is refreshed by Codex CLI', async () => {
		const refreshedJson = JSON.stringify({ accessToken: 'tok_NEW', refreshToken: 'ref_xyz' });
		mockReadFile.mockResolvedValue(refreshedJson);
		mockFindCredentialIdByEnvVarKey.mockResolvedValue(42);

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { CODEX_AUTH_JSON: AUTH_JSON },
		});

		await engine.execute(input);

		expect(mockFindCredentialIdByEnvVarKey).toHaveBeenCalledWith('org-1', 'CODEX_AUTH_JSON');
		expect(mockUpdateCredential).toHaveBeenCalledWith(42, { value: refreshedJson });
	});

	it('skips DB update when auth.json is unchanged after run', async () => {
		mockReadFile.mockResolvedValue(AUTH_JSON);

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { CODEX_AUTH_JSON: AUTH_JSON },
		});

		await engine.execute(input);

		expect(mockUpdateCredential).not.toHaveBeenCalled();
	});

	it('logs WARN and does not throw when credential row is not found for refresh', async () => {
		const refreshedJson = JSON.stringify({ accessToken: 'tok_NEW', refreshToken: 'ref_xyz' });
		mockReadFile.mockResolvedValue(refreshedJson);
		mockFindCredentialIdByEnvVarKey.mockResolvedValue(null);

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { CODEX_AUTH_JSON: AUTH_JSON },
		});

		await expect(engine.execute(input)).resolves.not.toThrow();
		expect(input.logWriter).toHaveBeenCalledWith(
			'WARN',
			'Could not find CODEX_AUTH_JSON credential to update after token refresh',
			{},
		);
		expect(mockUpdateCredential).not.toHaveBeenCalled();
	});
});

describe('CodexEngine lifecycle hooks', () => {
	const AUTH_JSON = JSON.stringify({ accessToken: 'tok_abc', refreshToken: 'ref_xyz' });

	let workspaceDir: string;

	beforeEach(() => {
		workspaceDir = mkdtempSync(join(tmpdir(), 'cascade-codex-lifecycle-test-'));
		vi.clearAllMocks();
		mockMkdir.mockResolvedValue(undefined);
		mockWriteFile.mockResolvedValue(undefined);
		mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
		mockFindCredentialIdByEnvVarKey.mockResolvedValue(null);
		mockUpdateCredential.mockResolvedValue(undefined);
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

	it('afterExecute calls captureRefreshedToken', async () => {
		const refreshedJson = JSON.stringify({ accessToken: 'tok_NEW', refreshToken: 'ref_xyz' });
		mockReadFile.mockResolvedValue(refreshedJson);
		mockFindCredentialIdByEnvVarKey.mockResolvedValue(42);

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { CODEX_AUTH_JSON: AUTH_JSON },
		});

		// Simulate adapter lifecycle: beforeExecute stores originalAuthJson, afterExecute compares
		await engine.beforeExecute(input);
		await engine.afterExecute(input, { success: true, output: '' });

		expect(mockFindCredentialIdByEnvVarKey).toHaveBeenCalledWith('org-1', 'CODEX_AUTH_JSON');
		expect(mockUpdateCredential).toHaveBeenCalledWith(42, { value: refreshedJson });
	});

	it('afterExecute completes without throwing', async () => {
		const engine = new CodexEngine();
		const plan = makeInput({ repoDir: workspaceDir });

		await expect(engine.afterExecute(plan, { success: true, output: '' })).resolves.not.toThrow();
	});

	it('adapter lifecycle: execute does not double-capture token when adapter calls afterExecute', async () => {
		const refreshedJson = JSON.stringify({ accessToken: 'tok_NEW', refreshToken: 'ref_xyz' });
		mockReadFile.mockResolvedValue(refreshedJson);
		mockFindCredentialIdByEnvVarKey.mockResolvedValue(42);

		const engine = new CodexEngine();
		const input = makeInput({
			repoDir: workspaceDir,
			projectSecrets: { CODEX_AUTH_JSON: AUTH_JSON },
		});

		// Simulate adapter: beforeExecute → execute → afterExecute
		await engine.beforeExecute(input);
		await engine.execute(input);
		await engine.afterExecute(input, { success: true, output: '' });

		// captureRefreshedToken should be called exactly once (from afterExecute, not from execute's finally)
		expect(mockFindCredentialIdByEnvVarKey).toHaveBeenCalledTimes(1);
	});
});

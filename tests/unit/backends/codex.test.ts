import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.fn();
const mockStoreLlmCall = vi.fn().mockResolvedValue(undefined);

vi.mock('node:child_process', () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
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
import { CodexEngine, resolveCodexModel } from '../../../src/backends/codex/index.js';
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
			defaults: {
				model: DEFAULT_CODEX_MODEL,
				agentModels: {},
				maxIterations: 20,
				agentIterations: {},
				watchdogTimeoutMs: 1800000,
				workItemBudgetUsd: 5,
				agentEngine: 'codex',
				engineSettings: {},
				progressModel: 'progress-model',
				progressIntervalMinutes: 5,
			},
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

	it('falls back for non-Codex models', () => {
		expect(resolveCodexModel('openrouter:google/gemini-3-flash-preview')).toBe(DEFAULT_CODEX_MODEL);
	});
});

describe('resolveCodexSettings', () => {
	it('defaults to read-only when agent cannot write', () => {
		const input = makeInput({
			nativeToolCapabilities: ['fs:read'],
		});

		expect(resolveCodexSettings(input.project, input.config, input.nativeToolCapabilities)).toEqual(
			{
				approvalPolicy: 'never',
				sandboxMode: 'read-only',
				webSearch: false,
				reasoningEffort: undefined,
			},
		);
	});

	it('merges project settings over defaults', () => {
		const input = makeInput({
			config: {
				...makeInput().config,
				defaults: {
					...makeInput().config.defaults,
					engineSettings: { codex: { approvalPolicy: 'never', sandboxMode: 'read-only' } },
				},
			},
			project: {
				...makeInput().project,
				engineSettings: { codex: { sandboxMode: 'workspace-write', webSearch: true } },
			},
		});

		expect(resolveCodexSettings(input.project, input.config, input.nativeToolCapabilities)).toEqual(
			{
				approvalPolicy: 'never',
				sandboxMode: 'workspace-write',
				webSearch: true,
				reasoningEffort: undefined,
			},
		);
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
					JSON.stringify({ text: 'Thinking...' }),
					JSON.stringify({
						tool_name: 'Bash',
						tool_input: { command: 'cascade-tools session finish --comment done' },
					}),
					JSON.stringify({
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
});

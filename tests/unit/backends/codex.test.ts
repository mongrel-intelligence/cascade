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

describe('resolveCodexSettings', () => {
	it('defaults to read-only when agent cannot write', () => {
		const input = makeInput({
			nativeToolCapabilities: ['fs:read'],
		});

		expect(resolveCodexSettings(input.project, input.nativeToolCapabilities)).toEqual({
			approvalPolicy: 'never',
			sandboxMode: 'read-only',
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

	it('does not include --search or -c web_search when webSearch is false', () => {
		const args = buildArgs(
			makeInput(),
			{ ...baseSettings, webSearch: false },
			'model-x',
			'/tmp/last.json',
		);
		expect(args).not.toContain('--search');
		expect(args.join(' ')).not.toContain('web_search');
	});

	it('includes --search when webSearch is true', () => {
		const args = buildArgs(
			makeInput(),
			{ ...baseSettings, webSearch: true },
			'model-x',
			'/tmp/last.json',
		);
		expect(args).toContain('--search');
		expect(args.join(' ')).not.toContain('web_search');
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

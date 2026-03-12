import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.fn();
const mockStoreLlmCall = vi.fn().mockResolvedValue(undefined);
const mockCreateOpencodeClient = vi.fn();
const mockCreateServer = vi.fn();

vi.mock('node:child_process', () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('node:net', () => ({
	createServer: (...args: unknown[]) => mockCreateServer(...args),
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	storeLlmCall: (...args: unknown[]) => mockStoreLlmCall(...args),
}));

vi.mock('@opencode-ai/sdk/client', () => ({
	createOpencodeClient: (...args: unknown[]) => mockCreateOpencodeClient(...args),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import {
	OpenCodeEngine,
	buildPermissionConfig,
	resolveOpenCodeAgent,
	resolveOpenCodeModel,
} from '../../../src/backends/opencode/index.js';
import { DEFAULT_OPENCODE_MODEL } from '../../../src/backends/opencode/models.js';
import { resolveOpenCodeSettings } from '../../../src/backends/opencode/settings.js';
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
				model: DEFAULT_OPENCODE_MODEL,
				agentModels: {},
				maxIterations: 20,
				agentIterations: {},
				watchdogTimeoutMs: 1800000,
				workItemBudgetUsd: 5,
				agentEngine: 'opencode',
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
		model: DEFAULT_OPENCODE_MODEL,
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

function createMockChild(output = 'opencode server listening on http://127.0.0.1:4101\n') {
	const child = new EventEmitter() as EventEmitter & {
		stdout: PassThrough;
		stderr: PassThrough;
		kill: ReturnType<typeof vi.fn>;
	};
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = vi.fn();

	queueMicrotask(() => {
		child.stdout.write(output);
	});

	return child;
}

function createEventStream(events: Array<Record<string, unknown>>) {
	return {
		stream: (async function* () {
			for (const event of events) {
				yield event;
			}
		})(),
	};
}

function createMockPortServer(port = 4101) {
	return {
		once: vi.fn(),
		listen: vi.fn((_listenPort: number, _host: string, callback: () => void) => callback()),
		address: vi.fn(() => ({ port })),
		close: vi.fn((callback?: (error?: Error) => void) => callback?.()),
	};
}

describe('resolveOpenCodeModel', () => {
	it('passes through provider/model values', () => {
		expect(resolveOpenCodeModel('openai/gpt-5')).toBe('openai/gpt-5');
	});

	it('normalizes provider:model values', () => {
		expect(resolveOpenCodeModel('openrouter:google/gemini-3-flash-preview')).toBe(
			'openrouter/google/gemini-3-flash-preview',
		);
	});

	it('falls back for unsupported values', () => {
		expect(resolveOpenCodeModel('gpt-5')).toBe(DEFAULT_OPENCODE_MODEL);
	});
});

describe('resolveOpenCodeAgent', () => {
	it('uses build for write-capable runs when auto', () => {
		expect(resolveOpenCodeAgent('auto', ['fs:read', 'fs:write'])).toBe('build');
	});

	it('uses plan for read-only runs when auto', () => {
		expect(resolveOpenCodeAgent('auto', ['fs:read'])).toBe('plan');
	});
});

describe('buildPermissionConfig', () => {
	it('denies write, bash, and web by default', () => {
		expect(buildPermissionConfig(['fs:read'], false)).toEqual({
			edit: 'deny',
			bash: 'deny',
			webfetch: 'deny',
			doom_loop: 'deny',
			external_directory: 'deny',
		});
	});

	it('allows write, bash, and web when configured', () => {
		expect(buildPermissionConfig(['fs:write', 'shell:exec'], true)).toEqual({
			edit: 'allow',
			bash: 'allow',
			webfetch: 'allow',
			doom_loop: 'deny',
			external_directory: 'deny',
		});
	});
});

describe('resolveOpenCodeSettings', () => {
	it('defaults to auto agent and webSearch=false', () => {
		const input = makeInput();
		expect(resolveOpenCodeSettings(input.project, input.config)).toEqual({
			agent: 'auto',
			webSearch: false,
		});
	});

	it('merges project settings over defaults', () => {
		const input = makeInput({
			config: {
				...makeInput().config,
				defaults: {
					...makeInput().config.defaults,
					engineSettings: { opencode: { agent: 'plan', webSearch: false } },
				},
			},
			project: {
				...makeInput().project,
				engineSettings: { opencode: { agent: 'build', webSearch: true } },
			},
		});

		expect(resolveOpenCodeSettings(input.project, input.config)).toEqual({
			agent: 'build',
			webSearch: true,
		});
	});
});

describe('OpenCodeEngine', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateServer.mockReturnValue(createMockPortServer());
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('executes OpenCode via the SDK client and streams progress', async () => {
		mockSpawn.mockReturnValue(createMockChild());

		const sessionCreate = vi.fn().mockResolvedValue({ data: { id: 'session-1' } });
		const sessionPrompt = vi.fn().mockResolvedValue({
			data: {
				info: { id: 'assistant-1', cost: 0.42 },
				parts: [
					{
						id: 'text-final',
						sessionID: 'session-1',
						messageID: 'assistant-1',
						type: 'text',
						text: 'Finished work. https://github.com/owner/repo/pull/123',
					},
				],
			},
		});
		const sessionDelete = vi.fn().mockResolvedValue(true);
		const respondPermission = vi.fn().mockResolvedValue(true);
		const subscribe = vi.fn().mockResolvedValue(
			createEventStream([
				{
					type: 'permission.updated',
					properties: {
						id: 'perm-1',
						type: 'edit',
						sessionID: 'session-1',
						messageID: 'assistant-1',
						title: 'Edit file',
						metadata: {},
						time: { created: Date.now() },
					},
				},
				{
					type: 'message.part.updated',
					properties: {
						part: {
							id: 'step-1',
							sessionID: 'session-1',
							messageID: 'assistant-1',
							type: 'step-start',
						},
					},
				},
				{
					type: 'message.part.updated',
					properties: {
						part: {
							id: 'tool-1',
							sessionID: 'session-1',
							messageID: 'assistant-1',
							type: 'tool',
							callID: 'call-1',
							tool: 'bash',
							state: {
								status: 'running',
								input: { command: 'cascade-tools session finish --comment done' },
								time: { start: Date.now() },
							},
						},
					},
				},
				{
					type: 'message.part.updated',
					properties: {
						part: {
							id: 'text-1',
							sessionID: 'session-1',
							messageID: 'assistant-1',
							type: 'text',
							text: 'Working...',
						},
						delta: 'Working...',
					},
				},
				{
					type: 'message.part.updated',
					properties: {
						part: {
							id: 'finish-1',
							sessionID: 'session-1',
							messageID: 'assistant-1',
							type: 'step-finish',
							reason: 'done',
							cost: 0.42,
							tokens: {
								input: 12,
								output: 8,
								reasoning: 3,
								cache: { read: 2, write: 0 },
							},
						},
					},
				},
				{
					type: 'session.idle',
					properties: {
						sessionID: 'session-1',
					},
				},
			]),
		);

		mockCreateOpencodeClient.mockImplementation(() => ({
			session: {
				create: sessionCreate,
				prompt: sessionPrompt,
				delete: sessionDelete,
			},
			event: {
				subscribe,
			},
			postSessionIdPermissionsPermissionId: respondPermission,
		}));

		const engine = new OpenCodeEngine();
		const input = makeInput({ runId: 'run-123', engineLogPath: '/tmp/opencode.log' });
		const result = await engine.execute(input);

		expect(result.success).toBe(true);
		expect(result.output).toContain('Finished work.');
		expect(result.prUrl).toBe('https://github.com/owner/repo/pull/123');
		expect(result.cost).toBe(0.42);
		expect(input.progressReporter.onIteration).toHaveBeenCalledWith(1, 20);
		expect(input.progressReporter.onToolCall).toHaveBeenCalledWith('bash', {
			command: 'cascade-tools session finish --comment done',
		});
		expect(input.progressReporter.onText).toHaveBeenCalledWith('Working...');
		expect(respondPermission).toHaveBeenCalledWith(
			expect.objectContaining({
				path: { id: 'session-1', permissionID: 'perm-1' },
				body: { response: 'always' },
			}),
		);
		expect(mockStoreLlmCall).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: 'run-123',
				costUsd: 0.42,
				inputTokens: 12,
				outputTokens: 8,
				cachedTokens: 2,
				model: DEFAULT_OPENCODE_MODEL,
			}),
		);
	});

	it('returns an error when the assistant reports failure', async () => {
		mockSpawn.mockReturnValue(createMockChild());

		mockCreateOpencodeClient.mockImplementation(() => ({
			session: {
				create: vi.fn().mockResolvedValue({ data: { id: 'session-err' } }),
				prompt: vi.fn().mockResolvedValue({
					data: {
						info: {
							id: 'assistant-err',
							cost: 0,
							error: {
								name: 'ProviderAuthError',
								data: { providerID: 'openai', message: 'bad auth' },
							},
						},
						parts: [],
					},
				}),
				delete: vi.fn().mockResolvedValue(true),
			},
			event: {
				subscribe: vi
					.fn()
					.mockResolvedValue(
						createEventStream([{ type: 'session.idle', properties: { sessionID: 'session-err' } }]),
					),
			},
			postSessionIdPermissionsPermissionId: vi.fn(),
		}));

		const engine = new OpenCodeEngine();
		const result = await engine.execute(makeInput());

		expect(result.success).toBe(false);
		expect(result.error).toBe('bad auth');
	});

	it('continues the same session when PR completion checks fail after a clean turn', async () => {
		mockSpawn.mockReturnValue(createMockChild());
		const tempDir = mkdtempSync(join(tmpdir(), 'opencode-pr-sidecar-'));
		const prSidecarPath = join(tempDir, 'pr-sidecar.json');
		const sessionPrompt = vi
			.fn()
			.mockResolvedValueOnce({
				data: {
					info: { id: 'assistant-first', cost: 0.1 },
					parts: [
						{
							id: 'text-first',
							sessionID: 'session-followup',
							messageID: 'assistant-first',
							type: 'text',
							text: 'Initial exploration complete.',
						},
					],
				},
			})
			.mockImplementationOnce(async () => {
				writeFileSync(
					prSidecarPath,
					JSON.stringify({
						prUrl: 'https://github.com/owner/repo/pull/123',
						source: 'cascade-tools scm create-pr',
					}),
				);
				return {
					data: {
						info: { id: 'assistant-second', cost: 0.2 },
						parts: [
							{
								id: 'text-second',
								sessionID: 'session-followup',
								messageID: 'assistant-second',
								type: 'text',
								text: 'PR created successfully.',
							},
						],
					},
				};
			});

		mockCreateOpencodeClient.mockImplementation(() => ({
			session: {
				create: vi.fn().mockResolvedValue({ data: { id: 'session-followup' } }),
				prompt: sessionPrompt,
				delete: vi.fn().mockResolvedValue(true),
			},
			event: {
				subscribe: vi.fn().mockResolvedValue(
					createEventStream([
						{ type: 'session.idle', properties: { sessionID: 'session-followup' } },
						{ type: 'session.idle', properties: { sessionID: 'session-followup' } },
					]),
				),
			},
			postSessionIdPermissionsPermissionId: vi.fn(),
		}));

		const engine = new OpenCodeEngine();
		const logWriter = vi.fn();
		const result = await engine.execute(
			makeInput({
				logWriter,
				completionRequirements: {
					requiresPR: true,
					prSidecarPath,
					maxContinuationTurns: 1,
				},
			}),
		);
		rmSync(tempDir, { recursive: true, force: true });

		expect(result.success).toBe(true);
		expect(result.prUrl).toBe('https://github.com/owner/repo/pull/123');
		expect(result.prEvidence).toEqual({
			source: 'native-tool-sidecar',
			authoritative: true,
			command: 'cascade-tools scm create-pr',
		});
		expect(sessionPrompt).toHaveBeenCalledTimes(2);
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'OpenCode completion check failed; continuing session',
			expect.objectContaining({
				reason: 'Agent completed but no authoritative PR creation was recorded',
				continuationTurn: 1,
			}),
		);
	});

	it('retries transient fetch failures when creating a session', async () => {
		vi.useFakeTimers();
		mockSpawn.mockReturnValue(createMockChild());

		const sessionCreate = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('fetch failed'))
			.mockResolvedValue({ data: { id: 'session-retry' } });
		mockCreateOpencodeClient.mockImplementation(() => ({
			session: {
				create: sessionCreate,
				prompt: vi.fn().mockResolvedValue({
					data: {
						info: { id: 'assistant-1', cost: 0 },
						parts: [],
					},
				}),
				delete: vi.fn().mockResolvedValue(true),
			},
			event: {
				subscribe: vi
					.fn()
					.mockResolvedValue(
						createEventStream([
							{ type: 'session.idle', properties: { sessionID: 'session-retry' } },
						]),
					),
			},
			postSessionIdPermissionsPermissionId: vi.fn(),
		}));

		const engine = new OpenCodeEngine();
		const resultPromise = engine.execute(makeInput());
		await vi.runAllTimersAsync();
		const result = await resultPromise;
		vi.useRealTimers();

		expect(result.success).toBe(true);
		expect(sessionCreate).toHaveBeenCalledTimes(2);
	});

	it('retries transient fetch failures when prompting before any stream output', async () => {
		vi.useFakeTimers();
		mockSpawn.mockReturnValue(createMockChild());

		const sessionPrompt = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('fetch failed'))
			.mockResolvedValue({
				data: {
					info: { id: 'assistant-retry', cost: 0.1 },
					parts: [
						{
							id: 'text-final',
							sessionID: 'session-prompt-retry',
							messageID: 'assistant-retry',
							type: 'text',
							text: 'Prompt retry succeeded.',
						},
					],
				},
			});
		mockCreateOpencodeClient.mockImplementation(() => ({
			session: {
				create: vi.fn().mockResolvedValue({ data: { id: 'session-prompt-retry' } }),
				prompt: sessionPrompt,
				delete: vi.fn().mockResolvedValue(true),
			},
			event: {
				subscribe: vi
					.fn()
					.mockResolvedValue(
						createEventStream([
							{ type: 'session.idle', properties: { sessionID: 'session-prompt-retry' } },
						]),
					),
			},
			postSessionIdPermissionsPermissionId: vi.fn(),
		}));

		const engine = new OpenCodeEngine();
		const resultPromise = engine.execute(makeInput());
		await vi.runAllTimersAsync();
		const result = await resultPromise;
		vi.useRealTimers();

		expect(result.success).toBe(true);
		expect(result.output).toContain('Prompt retry succeeded.');
		expect(sessionPrompt).toHaveBeenCalledTimes(2);
	});

	it('completes from streamed state when prompt response fetch fails after output begins', async () => {
		mockSpawn.mockReturnValue(createMockChild());

		const logWriter = vi.fn();
		mockCreateOpencodeClient.mockImplementation(() => ({
			session: {
				create: vi.fn().mockResolvedValue({ data: { id: 'session-stream-only' } }),
				prompt: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
				delete: vi.fn().mockResolvedValue(true),
			},
			event: {
				subscribe: vi.fn().mockResolvedValue(
					createEventStream([
						{
							type: 'message.part.updated',
							properties: {
								part: {
									id: 'step-1',
									sessionID: 'session-stream-only',
									messageID: 'assistant-stream-only',
									type: 'step-start',
								},
							},
						},
						{
							type: 'message.part.updated',
							properties: {
								part: {
									id: 'text-1',
									sessionID: 'session-stream-only',
									messageID: 'assistant-stream-only',
									type: 'text',
									text: 'Recovered from stream output.',
								},
								delta: 'Recovered from stream output.',
							},
						},
						{
							type: 'message.part.updated',
							properties: {
								part: {
									id: 'finish-1',
									sessionID: 'session-stream-only',
									messageID: 'assistant-stream-only',
									type: 'step-finish',
									reason: 'done',
									cost: 0.3,
									tokens: {
										input: 7,
										output: 4,
										reasoning: 0,
										cache: { read: 0, write: 0 },
									},
								},
							},
						},
						{
							type: 'session.idle',
							properties: { sessionID: 'session-stream-only' },
						},
					]),
				),
			},
			postSessionIdPermissionsPermissionId: vi.fn(),
		}));

		const engine = new OpenCodeEngine();
		const result = await engine.execute(makeInput({ logWriter }));

		expect(result.success).toBe(true);
		expect(result.output).toContain('Recovered from stream output.');
		expect(result.cost).toBe(0.3);
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'OpenCode prompt response lost after stream output began',
			expect.objectContaining({ sessionId: 'session-stream-only', error: 'fetch failed' }),
		);
	});

	it('preserves partial output when the event stream fails mid-run', async () => {
		mockSpawn.mockReturnValue(createMockChild());

		mockCreateOpencodeClient.mockImplementation(() => ({
			session: {
				create: vi.fn().mockResolvedValue({ data: { id: 'session-partial' } }),
				prompt: vi.fn().mockResolvedValue({
					data: {
						info: { id: 'assistant-partial', cost: 0.2 },
						parts: [],
					},
				}),
				delete: vi.fn().mockResolvedValue(true),
			},
			event: {
				subscribe: vi.fn().mockResolvedValue({
					stream: (async function* () {
						yield {
							type: 'message.part.updated',
							properties: {
								part: {
									id: 'text-1',
									sessionID: 'session-partial',
									messageID: 'assistant-partial',
									type: 'text',
									text: 'Partial progress...',
								},
								delta: 'Partial progress...',
							},
						};
						throw new TypeError('fetch failed');
					})(),
				}),
			},
			postSessionIdPermissionsPermissionId: vi.fn(),
		}));

		const engine = new OpenCodeEngine();
		const result = await engine.execute(makeInput());

		expect(result.success).toBe(false);
		expect(result.output).toContain('Partial progress...');
		expect(result.error).toContain('OpenCode transport failed after retries');
	});
});

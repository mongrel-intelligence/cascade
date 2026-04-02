/**
 * Unit tests for OpenCode stream event handling helpers.
 *
 * Covers appendPartialOutput, getPartialOutput, reportToolPart,
 * handleSessionTerminalEvent, handleMessagePartUpdated, and handlePermissionEvent
 * in isolation — no full engine orchestration required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────

const mockStoreLlmCall = vi.fn().mockResolvedValue(undefined);
const mockAppendFileSync = vi.fn();

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	storeLlmCall: (...args: unknown[]) => mockStoreLlmCall(...args),
}));

vi.mock('node:fs', () => ({
	appendFileSync: (...args: unknown[]) => mockAppendFileSync(...args),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// retryNativeToolOperation just calls the callback directly in tests to avoid
// timer complexity — we are not testing the retry mechanism here.
vi.mock('../../../src/backends/nativeToolRetry.js', () => ({
	retryNativeToolOperation: (fn: () => unknown) => fn(),
}));

// ── Imports after mocks ──────────────────────────────────────────────────────

import type { OpenCodeStreamState } from '../../../src/backends/opencode/stream.js';
import {
	appendPartialOutput,
	getPartialOutput,
	handleMessagePartUpdated,
	handlePermissionEvent,
	handleSessionTerminalEvent,
	reportToolPart,
} from '../../../src/backends/opencode/stream.js';
import type { AgentExecutionPlan } from '../../../src/backends/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
		config: { projects: [] },
		repoDir: '/tmp/repo',
		systemPrompt: 'You are an agent.',
		taskPrompt: 'Implement feature X.',
		cliToolsDir: '/usr/bin',
		availableTools: [],
		contextInjections: [],
		maxIterations: 20,
		budgetUsd: 5,
		model: 'anthropic/claude-3-5-sonnet',
		nativeToolCapabilities: ['fs:read', 'fs:write', 'shell:exec'],
		progressReporter: {
			onIteration: vi.fn().mockResolvedValue(undefined),
			onToolCall: vi.fn(),
			onText: vi.fn(),
		},
		logWriter: vi.fn(),
		agentInput: { workItemId: 'card-1' },
		projectSecrets: {},
		engineLogPath: undefined,
		...overrides,
	};
}

function makeState(overrides: Partial<OpenCodeStreamState> = {}): OpenCodeStreamState {
	return {
		sessionId: 'session-1',
		model: 'anthropic/claude-3-5-sonnet',
		input: makeInput(),
		permissionConfig: {
			edit: 'allow',
			bash: 'allow',
			webfetch: 'deny',
			doom_loop: 'deny',
			external_directory: 'deny',
		},
		reportedToolCalls: new Set(),
		seenTextPartIds: new Set(),
		iterationCount: 0,
		llmCallCount: 0,
		totalCost: 0,
		partialOutput: [],
		toolCallCount: 0,
		...overrides,
	};
}

function makePermissionClient(respondMock = vi.fn().mockResolvedValue(true)) {
	return {
		postSessionIdPermissionsPermissionId: respondMock,
	} as unknown as Parameters<typeof handlePermissionEvent>[0];
}

// ── appendPartialOutput ──────────────────────────────────────────────────────

describe('appendPartialOutput', () => {
	it('appends non-empty text to partialOutput', () => {
		const state = makeState();
		appendPartialOutput(state, 'Hello world');
		expect(state.partialOutput).toEqual(['Hello world']);
	});

	it('does not append whitespace-only text', () => {
		const state = makeState();
		appendPartialOutput(state, '   \n   ');
		expect(state.partialOutput).toHaveLength(0);
	});

	it('does not append empty string', () => {
		const state = makeState();
		appendPartialOutput(state, '');
		expect(state.partialOutput).toHaveLength(0);
	});

	it('trims leading and trailing whitespace before appending', () => {
		const state = makeState();
		appendPartialOutput(state, '  trimmed  ');
		expect(state.partialOutput).toEqual(['trimmed']);
	});

	it('accumulates multiple text chunks', () => {
		const state = makeState();
		appendPartialOutput(state, 'First');
		appendPartialOutput(state, 'Second');
		appendPartialOutput(state, 'Third');
		expect(state.partialOutput).toEqual(['First', 'Second', 'Third']);
	});
});

// ── getPartialOutput ─────────────────────────────────────────────────────────

describe('getPartialOutput', () => {
	it('returns empty string when state is undefined', () => {
		expect(getPartialOutput(undefined)).toBe('');
	});

	it('returns empty string when partialOutput is empty', () => {
		const state = makeState();
		expect(getPartialOutput(state)).toBe('');
	});

	it('joins multiple chunks with newlines', () => {
		const state = makeState({ partialOutput: ['First', 'Second', 'Third'] });
		expect(getPartialOutput(state)).toBe('First\nSecond\nThird');
	});

	it('trims the joined result', () => {
		const state = makeState({ partialOutput: ['  text  '] });
		expect(getPartialOutput(state)).toBe('text');
	});

	it('returns single-chunk text without extra newlines', () => {
		const state = makeState({ partialOutput: ['Only chunk'] });
		expect(getPartialOutput(state)).toBe('Only chunk');
	});
});

// ── reportToolPart ───────────────────────────────────────────────────────────

describe('reportToolPart', () => {
	function makeToolPart(
		overrides: {
			callID?: string;
			tool?: string;
			status?: string;
			input?: Record<string, unknown>;
		} = {},
	) {
		return {
			id: 'tool-1',
			sessionID: 'session-1',
			messageID: 'msg-1',
			type: 'tool' as const,
			callID: overrides.callID ?? 'call-1',
			tool: overrides.tool ?? 'bash',
			state: {
				status: overrides.status ?? 'running',
				input: overrides.input ?? { command: 'ls' },
				time: { start: Date.now() },
			},
		};
	}

	it('calls onToolCall for a running tool part not yet reported', () => {
		const input = makeInput();
		const reportedToolCalls = new Set<string>();
		const part = makeToolPart({ status: 'running', tool: 'bash', input: { command: 'ls -la' } });
		reportToolPart(input, part as never, reportedToolCalls);
		expect(input.progressReporter.onToolCall).toHaveBeenCalledWith('bash', { command: 'ls -la' });
	});

	it('skips reporting when tool call is in pending state', () => {
		const input = makeInput();
		const reportedToolCalls = new Set<string>();
		const part = makeToolPart({ status: 'pending' });
		reportToolPart(input, part as never, reportedToolCalls);
		expect(input.progressReporter.onToolCall).not.toHaveBeenCalled();
	});

	it('skips reporting when callID has already been reported (deduplication)', () => {
		const input = makeInput();
		const reportedToolCalls = new Set<string>(['call-1']);
		const part = makeToolPart({ callID: 'call-1', status: 'running' });
		reportToolPart(input, part as never, reportedToolCalls);
		expect(input.progressReporter.onToolCall).not.toHaveBeenCalled();
	});

	it('adds the callID to reportedToolCalls after reporting', () => {
		const input = makeInput();
		const reportedToolCalls = new Set<string>();
		const part = makeToolPart({ callID: 'call-42', status: 'running' });
		reportToolPart(input, part as never, reportedToolCalls);
		expect(reportedToolCalls.has('call-42')).toBe(true);
	});

	it('does not add the callID to reportedToolCalls when still pending', () => {
		const input = makeInput();
		const reportedToolCalls = new Set<string>();
		const part = makeToolPart({ callID: 'call-pending', status: 'pending' });
		reportToolPart(input, part as never, reportedToolCalls);
		expect(reportedToolCalls.has('call-pending')).toBe(false);
	});

	it('reports distinct tool calls independently', () => {
		const input = makeInput();
		const reportedToolCalls = new Set<string>();
		reportToolPart(
			input,
			makeToolPart({ callID: 'call-a', tool: 'bash' }) as never,
			reportedToolCalls,
		);
		reportToolPart(
			input,
			makeToolPart({ callID: 'call-b', tool: 'read' }) as never,
			reportedToolCalls,
		);
		expect(input.progressReporter.onToolCall).toHaveBeenCalledTimes(2);
		expect(reportedToolCalls.size).toBe(2);
	});
});

// ── handleSessionTerminalEvent ───────────────────────────────────────────────

describe('handleSessionTerminalEvent', () => {
	it('returns false for unrelated event types', () => {
		const state = makeState();
		const result = handleSessionTerminalEvent(
			{ type: 'message.part.updated', properties: {} } as never,
			state,
		);
		expect(result).toBe(false);
	});

	describe('session.error', () => {
		it('sets finalError from error.data.message and calls idleRejecter', () => {
			const idleRejecter = vi.fn();
			const state = makeState({ idleRejecter });
			const result = handleSessionTerminalEvent(
				{
					type: 'session.error',
					properties: {
						sessionID: 'session-1',
						error: { name: 'SomeError', data: { message: 'Something broke' } },
					},
				} as never,
				state,
			);
			expect(result).toBe(true);
			expect(state.finalError).toBe('Something broke');
			expect(idleRejecter).toHaveBeenCalledWith(expect.any(Error));
			expect(idleRejecter.mock.calls[0][0].message).toBe('Something broke');
		});

		it('falls back to error.name when data.message is not a string', () => {
			const idleRejecter = vi.fn();
			const state = makeState({ idleRejecter });
			handleSessionTerminalEvent(
				{
					type: 'session.error',
					properties: {
						sessionID: 'session-1',
						error: { name: 'ProviderAuthError', data: { message: 42 } },
					},
				} as never,
				state,
			);
			expect(state.finalError).toBe('ProviderAuthError');
		});

		it('handles session.error with no sessionID (global error)', () => {
			const idleRejecter = vi.fn();
			const state = makeState({ idleRejecter });
			const result = handleSessionTerminalEvent(
				{
					type: 'session.error',
					properties: {
						sessionID: undefined,
						error: { name: 'GlobalError', data: { message: 'global failure' } },
					},
				} as never,
				state,
			);
			expect(result).toBe(true);
			expect(state.finalError).toBe('global failure');
		});

		it('does not trigger when sessionID mismatches', () => {
			const idleRejecter = vi.fn();
			const state = makeState({ idleRejecter, sessionId: 'session-1' });
			const result = handleSessionTerminalEvent(
				{
					type: 'session.error',
					properties: {
						sessionID: 'different-session',
						error: { name: 'OtherError', data: { message: 'other error' } },
					},
				} as never,
				state,
			);
			expect(result).toBe(false);
			expect(idleRejecter).not.toHaveBeenCalled();
		});

		it('calls idleRejecter with generic message when finalError is undefined', () => {
			const idleRejecter = vi.fn();
			const state = makeState({ idleRejecter });
			handleSessionTerminalEvent(
				{
					type: 'session.error',
					properties: {
						sessionID: 'session-1',
						error: undefined,
					},
				} as never,
				state,
			);
			expect(idleRejecter).toHaveBeenCalledWith(expect.any(Error));
			expect(idleRejecter.mock.calls[0][0].message).toBe('OpenCode session error');
		});
	});

	describe('session.idle', () => {
		it('calls idleResolver and returns true when sessionID matches', () => {
			const idleResolver = vi.fn();
			const state = makeState({ idleResolver });
			const result = handleSessionTerminalEvent(
				{
					type: 'session.idle',
					properties: { sessionID: 'session-1' },
				} as never,
				state,
			);
			expect(result).toBe(true);
			expect(idleResolver).toHaveBeenCalled();
		});

		it('returns false when sessionID does not match', () => {
			const idleResolver = vi.fn();
			const state = makeState({ idleResolver, sessionId: 'session-1' });
			const result = handleSessionTerminalEvent(
				{
					type: 'session.idle',
					properties: { sessionID: 'other-session' },
				} as never,
				state,
			);
			expect(result).toBe(false);
			expect(idleResolver).not.toHaveBeenCalled();
		});

		it('does not throw when idleResolver is not set', () => {
			const state = makeState({ idleResolver: undefined });
			expect(() =>
				handleSessionTerminalEvent(
					{ type: 'session.idle', properties: { sessionID: 'session-1' } } as never,
					state,
				),
			).not.toThrow();
		});
	});

	describe('session.status', () => {
		it('calls idleResolver and returns true when status type is idle and sessionID matches', () => {
			const idleResolver = vi.fn();
			const state = makeState({ idleResolver });
			const result = handleSessionTerminalEvent(
				{
					type: 'session.status',
					properties: {
						sessionID: 'session-1',
						status: { type: 'idle' },
					},
				} as never,
				state,
			);
			expect(result).toBe(true);
			expect(idleResolver).toHaveBeenCalled();
		});

		it('returns false when status type is not idle', () => {
			const idleResolver = vi.fn();
			const state = makeState({ idleResolver });
			const result = handleSessionTerminalEvent(
				{
					type: 'session.status',
					properties: {
						sessionID: 'session-1',
						status: { type: 'running' },
					},
				} as never,
				state,
			);
			expect(result).toBe(false);
			expect(idleResolver).not.toHaveBeenCalled();
		});

		it('returns false when sessionID mismatches for session.status', () => {
			const idleResolver = vi.fn();
			const state = makeState({ idleResolver, sessionId: 'session-1' });
			const result = handleSessionTerminalEvent(
				{
					type: 'session.status',
					properties: {
						sessionID: 'different-session',
						status: { type: 'idle' },
					},
				} as never,
				state,
			);
			expect(result).toBe(false);
			expect(idleResolver).not.toHaveBeenCalled();
		});
	});
});

// ── handleMessagePartUpdated ─────────────────────────────────────────────────

describe('handleMessagePartUpdated', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function makeMessagePartEvent(
		part: Record<string, unknown>,
		delta?: string,
	): Parameters<typeof handleMessagePartUpdated>[0] {
		return {
			type: 'message.part.updated',
			properties: {
				part: {
					sessionID: 'session-1',
					messageID: 'msg-1',
					...part,
				},
				...(delta !== undefined ? { delta } : {}),
			},
		} as never;
	}

	it('ignores events whose sessionID does not match state.sessionId', async () => {
		const state = makeState({ sessionId: 'session-1' });
		const event = makeMessagePartEvent({
			id: 'step-1',
			type: 'step-start',
			sessionID: 'other-session',
		});
		await handleMessagePartUpdated(event, state);
		expect(state.iterationCount).toBe(0);
		expect(state.input.progressReporter.onIteration).not.toHaveBeenCalled();
	});

	describe('step-start', () => {
		it('increments iterationCount and calls onIteration', async () => {
			const state = makeState({ iterationCount: 0 });
			const event = makeMessagePartEvent({ id: 'step-1', type: 'step-start' });
			await handleMessagePartUpdated(event, state);
			expect(state.iterationCount).toBe(1);
			expect(state.input.progressReporter.onIteration).toHaveBeenCalledWith(1, 20);
		});

		it('increments iterationCount cumulatively on each step-start', async () => {
			const state = makeState({ iterationCount: 2 });
			const event = makeMessagePartEvent({ id: 'step-3', type: 'step-start' });
			await handleMessagePartUpdated(event, state);
			expect(state.iterationCount).toBe(3);
			expect(state.input.progressReporter.onIteration).toHaveBeenCalledWith(3, 20);
		});
	});

	describe('step-finish', () => {
		beforeEach(() => {
			// clearMocks resets return values; restore a resolved promise so
			// logLlmCall's fire-and-forget .catch() call does not throw.
			mockStoreLlmCall.mockResolvedValue(undefined);
		});

		function makeStepFinishEvent(cost = 0.5) {
			return makeMessagePartEvent({
				id: 'finish-1',
				type: 'step-finish',
				reason: 'done',
				cost,
				tokens: {
					input: 10,
					output: 5,
					reasoning: 2,
					cache: { read: 3, write: 0 },
				},
			});
		}

		it('increments llmCallCount', async () => {
			const state = makeState({ llmCallCount: 0 });
			await handleMessagePartUpdated(makeStepFinishEvent(), state);
			expect(state.llmCallCount).toBe(1);
		});

		it('accumulates totalCost', async () => {
			const state = makeState({ totalCost: 0.3 });
			await handleMessagePartUpdated(makeStepFinishEvent(0.2), state);
			expect(state.totalCost).toBeCloseTo(0.5);
		});

		it('calls storeLlmCall when runId is set', async () => {
			const input = makeInput({ runId: 'run-42' });
			const state = makeState({ input, llmCallCount: 0 });
			await handleMessagePartUpdated(makeStepFinishEvent(0.1), state);
			// logLlmCall is fire-and-forget; wait for microtasks
			await Promise.resolve();
			expect(mockStoreLlmCall).toHaveBeenCalledWith(
				expect.objectContaining({
					runId: 'run-42',
					costUsd: 0.1,
					inputTokens: 10,
					outputTokens: 5,
					cachedTokens: 3,
				}),
			);
		});

		it('does not call storeLlmCall when runId is absent', async () => {
			const input = makeInput({ runId: undefined });
			const state = makeState({ input });
			await handleMessagePartUpdated(makeStepFinishEvent(), state);
			await Promise.resolve();
			expect(mockStoreLlmCall).not.toHaveBeenCalled();
		});
	});

	describe('tool part', () => {
		it('increments toolCallCount for each tool part', async () => {
			const state = makeState({ toolCallCount: 0 });
			const event = makeMessagePartEvent({
				id: 'tool-1',
				type: 'tool',
				callID: 'call-1',
				tool: 'bash',
				state: {
					status: 'running',
					input: { command: 'echo hi' },
					time: { start: Date.now() },
				},
			});
			await handleMessagePartUpdated(event, state);
			expect(state.toolCallCount).toBe(1);
		});

		it('calls onToolCall for running tool parts', async () => {
			const state = makeState();
			const event = makeMessagePartEvent({
				id: 'tool-2',
				type: 'tool',
				callID: 'call-2',
				tool: 'read',
				state: {
					status: 'running',
					input: { path: '/tmp/file.txt' },
					time: { start: Date.now() },
				},
			});
			await handleMessagePartUpdated(event, state);
			expect(state.input.progressReporter.onToolCall).toHaveBeenCalledWith('read', {
				path: '/tmp/file.txt',
			});
		});

		it('does not call onToolCall for pending tool parts', async () => {
			const state = makeState();
			const event = makeMessagePartEvent({
				id: 'tool-pending',
				type: 'tool',
				callID: 'call-pending',
				tool: 'bash',
				state: {
					status: 'pending',
					input: {},
					time: { start: Date.now() },
				},
			});
			await handleMessagePartUpdated(event, state);
			expect(state.input.progressReporter.onToolCall).not.toHaveBeenCalled();
		});

		it('deduplicates tool calls with the same callID', async () => {
			const state = makeState();
			const reportedToolCalls = state.reportedToolCalls;
			const event = makeMessagePartEvent({
				id: 'tool-dup',
				type: 'tool',
				callID: 'call-dup',
				tool: 'bash',
				state: { status: 'running', input: { command: 'ls' }, time: { start: Date.now() } },
			});
			// Process the same event twice
			await handleMessagePartUpdated(event, state);
			await handleMessagePartUpdated(event, state);
			// toolCallCount is incremented each time (raw count), but onToolCall only once
			expect(state.toolCallCount).toBe(2);
			expect(state.input.progressReporter.onToolCall).toHaveBeenCalledTimes(1);
			expect(reportedToolCalls.has('call-dup')).toBe(true);
		});
	});

	describe('text parts', () => {
		it('appends text when delta is provided', async () => {
			const state = makeState();
			const event = makeMessagePartEvent(
				{ id: 'text-1', type: 'text', text: 'Hello world' },
				'Hello world',
			);
			await handleMessagePartUpdated(event, state);
			expect(state.partialOutput).toEqual(['Hello world']);
			expect(state.input.progressReporter.onText).toHaveBeenCalledWith('Hello world');
		});

		it('appends full text when no delta and part id not seen before', async () => {
			const state = makeState();
			const event = makeMessagePartEvent({ id: 'text-new', type: 'text', text: 'Full content' });
			await handleMessagePartUpdated(event, state);
			expect(state.partialOutput).toContain('Full content');
		});

		it('deduplicates text parts by id when no delta (non-streaming)', async () => {
			const state = makeState();
			const event = makeMessagePartEvent({ id: 'text-dedup', type: 'text', text: 'Repeated text' });
			await handleMessagePartUpdated(event, state);
			await handleMessagePartUpdated(event, state);
			// Only the first occurrence should be appended
			expect(state.partialOutput).toHaveLength(1);
			expect(state.partialOutput[0]).toBe('Repeated text');
		});

		it('allows the same part id to stream multiple delta chunks', async () => {
			const state = makeState();
			const partBase = { id: 'text-stream', type: 'text', text: 'Hello world' };
			// appendPartialOutput trims text, so 'Hello ' becomes 'Hello' and 'world' stays 'world'
			const event1 = makeMessagePartEvent(partBase, 'Hello');
			const event2 = makeMessagePartEvent(partBase, 'world');
			await handleMessagePartUpdated(event1, state);
			await handleMessagePartUpdated(event2, state);
			expect(state.partialOutput).toEqual(['Hello', 'world']);
			expect(state.input.progressReporter.onText).toHaveBeenCalledTimes(2);
		});

		it('skips synthetic text parts (no delta)', async () => {
			const state = makeState();
			const event = makeMessagePartEvent({
				id: 'text-synthetic',
				type: 'text',
				text: 'synthetic content',
				synthetic: true,
			});
			await handleMessagePartUpdated(event, state);
			expect(state.partialOutput).toHaveLength(0);
		});

		it('skips ignored text parts (no delta)', async () => {
			const state = makeState();
			const event = makeMessagePartEvent({
				id: 'text-ignored',
				type: 'text',
				text: 'ignored content',
				ignored: true,
			});
			await handleMessagePartUpdated(event, state);
			expect(state.partialOutput).toHaveLength(0);
		});

		it('calls logWriter with truncated text when content exceeds 300 chars', async () => {
			const logWriter = vi.fn();
			const input = makeInput({ logWriter });
			const state = makeState({ input });
			const longText = 'x'.repeat(350);
			const event = makeMessagePartEvent(
				{ id: 'text-long', type: 'text', text: longText },
				longText,
			);
			await handleMessagePartUpdated(event, state);
			expect(logWriter).toHaveBeenCalledWith(
				'INFO',
				'OpenCode text',
				expect.objectContaining({ text: expect.stringContaining('...') }),
			);
		});

		it('calls logWriter with full text when content is 300 chars or less', async () => {
			const logWriter = vi.fn();
			const input = makeInput({ logWriter });
			const state = makeState({ input });
			const shortText = 'x'.repeat(300);
			const event = makeMessagePartEvent(
				{ id: 'text-short', type: 'text', text: shortText },
				shortText,
			);
			await handleMessagePartUpdated(event, state);
			expect(logWriter).toHaveBeenCalledWith(
				'INFO',
				'OpenCode text',
				expect.objectContaining({ text: shortText }),
			);
		});
	});
});

// ── handlePermissionEvent ────────────────────────────────────────────────────

describe('handlePermissionEvent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function makePermissionEvent(
		overrides: { sessionID?: string; permissionId?: string; type?: string } = {},
	) {
		return {
			type: 'permission.updated',
			properties: {
				id: overrides.permissionId ?? 'perm-1',
				type: overrides.type ?? 'edit',
				sessionID: overrides.sessionID ?? 'session-1',
				messageID: 'msg-1',
				title: 'Edit file',
				metadata: {},
				time: { created: Date.now() },
			},
		} as never;
	}

	it('returns false when sessionID does not match state.sessionId', async () => {
		const respondMock = vi.fn().mockResolvedValue(true);
		const client = makePermissionClient(respondMock);
		const state = makeState({ sessionId: 'session-1' });
		const event = makePermissionEvent({ sessionID: 'other-session' });
		const result = await handlePermissionEvent(client, event, state);
		expect(result).toBe(false);
		expect(respondMock).not.toHaveBeenCalled();
	});

	it('returns true when sessionID matches and posts permission response', async () => {
		const respondMock = vi.fn().mockResolvedValue(true);
		const client = makePermissionClient(respondMock);
		const state = makeState({
			sessionId: 'session-1',
			permissionConfig: {
				edit: 'allow',
				bash: 'deny',
				webfetch: 'deny',
				doom_loop: 'deny',
				external_directory: 'deny',
			},
		});
		const event = makePermissionEvent({ type: 'edit', permissionId: 'perm-42' });
		const result = await handlePermissionEvent(client, event, state);
		expect(result).toBe(true);
		expect(respondMock).toHaveBeenCalledWith(
			expect.objectContaining({
				path: { id: 'session-1', permissionID: 'perm-42' },
				body: { response: 'always' },
				throwOnError: true,
			}),
		);
	});

	it('sends "reject" for a denied permission type', async () => {
		const respondMock = vi.fn().mockResolvedValue(true);
		const client = makePermissionClient(respondMock);
		const state = makeState({
			sessionId: 'session-1',
			permissionConfig: {
				edit: 'deny',
				bash: 'deny',
				webfetch: 'deny',
				doom_loop: 'deny',
				external_directory: 'deny',
			},
		});
		const event = makePermissionEvent({ type: 'edit', permissionId: 'perm-deny' });
		await handlePermissionEvent(client, event, state);
		expect(respondMock).toHaveBeenCalledWith(
			expect.objectContaining({
				body: { response: 'reject' },
			}),
		);
	});

	it('sends "always" for a bash permission when bash is allowed', async () => {
		const respondMock = vi.fn().mockResolvedValue(true);
		const client = makePermissionClient(respondMock);
		const state = makeState({
			permissionConfig: {
				edit: 'deny',
				bash: 'allow',
				webfetch: 'deny',
				doom_loop: 'deny',
				external_directory: 'deny',
			},
		});
		const event = makePermissionEvent({ type: 'bash', permissionId: 'perm-bash' });
		await handlePermissionEvent(client, event, state);
		expect(respondMock).toHaveBeenCalledWith(
			expect.objectContaining({
				body: { response: 'always' },
			}),
		);
	});

	it('sends "reject" for doom_loop even when config would theoretically allow it', async () => {
		const respondMock = vi.fn().mockResolvedValue(true);
		const client = makePermissionClient(respondMock);
		const state = makeState({
			permissionConfig: {
				edit: 'allow',
				bash: 'allow',
				webfetch: 'allow',
				doom_loop: 'deny',
				external_directory: 'deny',
			},
		});
		const event = makePermissionEvent({ type: 'doom_loop', permissionId: 'perm-doom' });
		await handlePermissionEvent(client, event, state);
		expect(respondMock).toHaveBeenCalledWith(
			expect.objectContaining({
				body: { response: 'reject' },
			}),
		);
	});

	it('normalizes the decision through resolvePermissionDecision + normalizePermissionDecision', async () => {
		// The chain: resolvePermissionDecision → 'allow' → normalizePermissionDecision → 'always'
		const respondMock = vi.fn().mockResolvedValue(true);
		const client = makePermissionClient(respondMock);
		const state = makeState({
			permissionConfig: {
				edit: 'allow',
				bash: 'allow',
				webfetch: 'allow',
				doom_loop: 'deny',
				external_directory: 'deny',
			},
		});
		const event = makePermissionEvent({ type: 'webfetch', permissionId: 'perm-web' });
		await handlePermissionEvent(client, event, state);
		expect(respondMock).toHaveBeenCalledWith(
			expect.objectContaining({
				body: { response: 'always' },
			}),
		);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockStoreLlmCall = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	storeLlmCall: (...args: unknown[]) => mockStoreLlmCall(...args),
}));

import { logClaudeCodeLlmCall } from '../../../src/backends/claude-code/messageProcessing.js';
import type { AgentExecutionPlan } from '../../../src/backends/types.js';

function makeInput(overrides: Partial<AgentExecutionPlan> = {}): AgentExecutionPlan {
	return {
		agentType: 'implementation',
		runId: 'run-1',
		project: { id: 'p1', name: 'Test', repo: 'o/r' } as AgentExecutionPlan['project'],
		config: { projects: [] } as AgentExecutionPlan['config'],
		repoDir: '/tmp/repo',
		systemPrompt: 'sys',
		taskPrompt: 'task',
		cliToolsDir: '/usr/bin',
		availableTools: [],
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
		...overrides,
	} as AgentExecutionPlan;
}

function makeAssistantMsg(usage: {
	input_tokens: number;
	output_tokens: number;
	cache_read_input_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
}) {
	return {
		type: 'assistant' as const,
		message: {
			id: 'msg_1',
			type: 'message',
			role: 'assistant',
			content: [],
			model: 'claude-sonnet-4-5-20250929',
			stop_reason: 'end_turn',
			stop_sequence: null,
			usage,
		},
		parent_tool_use_id: null,
		session_id: 'sess-1',
		uuid: 'uuid-1',
	};
}

describe('logClaudeCodeLlmCall', () => {
	beforeEach(() => {
		mockStoreLlmCall.mockClear();
	});

	it('sums input + cache_read + cache_creation into inputTokens', async () => {
		const input = makeInput();
		const msg = makeAssistantMsg({
			input_tokens: 8,
			output_tokens: 150,
			cache_read_input_tokens: 45000,
			cache_creation_input_tokens: 5000,
		});

		logClaudeCodeLlmCall(input, msg as never, 1, 'claude-sonnet-4-5-20250929');
		await Promise.resolve();

		expect(mockStoreLlmCall).toHaveBeenCalledOnce();
		const [stored] = mockStoreLlmCall.mock.calls[0];
		expect(stored.inputTokens).toBe(50008); // 8 + 45000 + 5000
	});

	it('uses only input_tokens when cache fields are null', async () => {
		const input = makeInput();
		const msg = makeAssistantMsg({
			input_tokens: 1200,
			output_tokens: 300,
			cache_read_input_tokens: null,
			cache_creation_input_tokens: null,
		});

		logClaudeCodeLlmCall(input, msg as never, 1, 'claude-sonnet-4-5-20250929');
		await Promise.resolve();

		const [stored] = mockStoreLlmCall.mock.calls[0];
		expect(stored.inputTokens).toBe(1200);
		expect(stored.cachedTokens).toBe(0);
	});

	it('sets cachedTokens to cache_read_input_tokens', async () => {
		const input = makeInput();
		const msg = makeAssistantMsg({
			input_tokens: 8,
			output_tokens: 100,
			cache_read_input_tokens: 30000,
			cache_creation_input_tokens: 0,
		});

		logClaudeCodeLlmCall(input, msg as never, 1, 'claude-sonnet-4-5-20250929');
		await Promise.resolve();

		const [stored] = mockStoreLlmCall.mock.calls[0];
		expect(stored.cachedTokens).toBe(30000);
	});

	it('calculates costUsd for a known model', async () => {
		const input = makeInput();
		// claude-sonnet-4-5-20250929 → 'anthropic:claude-sonnet-4-5' → $3/1M input, $15/1M output
		const msg = makeAssistantMsg({
			input_tokens: 1_000_000,
			output_tokens: 1_000_000,
			cache_read_input_tokens: null,
			cache_creation_input_tokens: null,
		});

		logClaudeCodeLlmCall(input, msg as never, 1, 'claude-sonnet-4-5-20250929');
		await Promise.resolve();

		const [stored] = mockStoreLlmCall.mock.calls[0];
		// $3 input + $15 output = $18
		expect(stored.costUsd).toBeCloseTo(18, 4);
	});

	it('leaves costUsd undefined for unknown model', async () => {
		const input = makeInput();
		const msg = makeAssistantMsg({
			input_tokens: 1000,
			output_tokens: 500,
			cache_read_input_tokens: null,
			cache_creation_input_tokens: null,
		});

		logClaudeCodeLlmCall(input, msg as never, 1, 'claude-unknown-model-99990101');
		await Promise.resolve();

		const [stored] = mockStoreLlmCall.mock.calls[0];
		expect(stored.costUsd).toBeUndefined();
	});

	it('is a no-op when usage is absent', () => {
		const input = makeInput();
		const msg = {
			type: 'assistant' as const,
			message: { content: [], model: 'x', usage: undefined },
			parent_tool_use_id: null,
			session_id: 's',
			uuid: 'u',
		};

		logClaudeCodeLlmCall(input, msg as never, 1, 'claude-sonnet-4-5-20250929');

		expect(mockStoreLlmCall).not.toHaveBeenCalled();
	});
});

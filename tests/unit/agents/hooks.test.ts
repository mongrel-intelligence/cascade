import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/llmMetrics.js', () => ({
	calculateCost: vi.fn().mockReturnValue(0.005),
}));

const mockStoreLlmCall = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	storeLlmCall: (...args: unknown[]) => mockStoreLlmCall(...args),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import type { AccumulatedLlmCall } from '../../../src/agents/utils/hooks.js';
import { createObserverHooks } from '../../../src/agents/utils/hooks.js';
import { createTrackingContext } from '../../../src/agents/utils/tracking.js';

describe('createObserverHooks - llmCallAccumulator', () => {
	const mockLogWriter = vi.fn();
	const mockLlmCallLogger = {
		logRequest: vi.fn(),
		logResponse: vi.fn(),
		getLogFiles: vi.fn().mockReturnValue([]),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('accumulates LLM call metrics when accumulator is provided', async () => {
		const accumulator: AccumulatedLlmCall[] = [];
		const trackingContext = createTrackingContext();

		const hooks = createObserverHooks({
			model: 'claude-3-sonnet',
			logWriter: mockLogWriter,
			trackingContext,
			llmCallLogger: mockLlmCallLogger as never,
			llmCallAccumulator: accumulator,
		});

		// Simulate a complete LLM call cycle
		await hooks.onLLMCallReady({
			iteration: 1,
			options: { messages: [], model: 'claude-3-sonnet' },
		} as never);

		await hooks.onLLMCallComplete({
			iteration: 1,
			rawResponse: '{"content": "response"}',
			usage: {
				inputTokens: 100,
				outputTokens: 50,
				cachedInputTokens: 10,
			},
		} as never);

		expect(accumulator).toHaveLength(1);
		expect(accumulator[0]).toEqual(
			expect.objectContaining({
				callNumber: 1,
				inputTokens: 100,
				outputTokens: 50,
				cachedTokens: 10,
				costUsd: 0.005,
			}),
		);
	});

	it('does not accumulate when no accumulator is provided', async () => {
		const trackingContext = createTrackingContext();

		const hooks = createObserverHooks({
			model: 'claude-3-sonnet',
			logWriter: mockLogWriter,
			trackingContext,
			llmCallLogger: mockLlmCallLogger as never,
			// No llmCallAccumulator
		});

		await hooks.onLLMCallReady({
			iteration: 1,
			options: { messages: [], model: 'claude-3-sonnet' },
		} as never);

		await hooks.onLLMCallComplete({
			iteration: 1,
			rawResponse: '{"content": "response"}',
			usage: {
				inputTokens: 100,
				outputTokens: 50,
			},
		} as never);

		// No error thrown, just no accumulation
	});

	it('does not accumulate when usage is missing', async () => {
		const accumulator: AccumulatedLlmCall[] = [];
		const trackingContext = createTrackingContext();

		const hooks = createObserverHooks({
			model: 'claude-3-sonnet',
			logWriter: mockLogWriter,
			trackingContext,
			llmCallLogger: mockLlmCallLogger as never,
			llmCallAccumulator: accumulator,
		});

		await hooks.onLLMCallReady({
			iteration: 1,
			options: { messages: [], model: 'claude-3-sonnet' },
		} as never);

		await hooks.onLLMCallComplete({
			iteration: 1,
			rawResponse: '{"content": "response"}',
			// No usage
		} as never);

		expect(accumulator).toHaveLength(0);
	});

	it('accumulates multiple calls sequentially', async () => {
		const accumulator: AccumulatedLlmCall[] = [];
		const trackingContext = createTrackingContext();

		const hooks = createObserverHooks({
			model: 'claude-3-sonnet',
			logWriter: mockLogWriter,
			trackingContext,
			llmCallLogger: mockLlmCallLogger as never,
			llmCallAccumulator: accumulator,
		});

		// First call
		await hooks.onLLMCallReady({
			iteration: 1,
			options: { messages: [], model: 'claude-3-sonnet' },
		} as never);
		await hooks.onLLMCallComplete({
			iteration: 1,
			rawResponse: 'res1',
			usage: { inputTokens: 100, outputTokens: 50 },
		} as never);

		// Second call
		await hooks.onLLMCallReady({
			iteration: 2,
			options: { messages: [{}, {}], model: 'claude-3-sonnet' },
		} as never);
		await hooks.onLLMCallComplete({
			iteration: 2,
			rawResponse: 'res2',
			usage: { inputTokens: 200, outputTokens: 100 },
		} as never);

		expect(accumulator).toHaveLength(2);
		expect(accumulator[0].callNumber).toBe(1);
		expect(accumulator[1].callNumber).toBe(2);
	});
});

describe('createObserverHooks - real-time DB logging', () => {
	const mockLogWriter = vi.fn();
	const mockLlmCallLogger = {
		logRequest: vi.fn(),
		logResponse: vi.fn(),
		getLogFiles: vi.fn().mockReturnValue([]),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('calls storeLlmCall fire-and-forget when runId is set', async () => {
		const trackingContext = createTrackingContext();
		const hooks = createObserverHooks({
			model: 'claude-3-sonnet',
			logWriter: mockLogWriter,
			trackingContext,
			llmCallLogger: mockLlmCallLogger as never,
			runId: 'run-123',
		});

		await hooks.onLLMCallReady({
			iteration: 1,
			options: { messages: [{ role: 'user', content: 'hello' }], model: 'claude-3-sonnet' },
		} as never);

		await hooks.onLLMCallComplete({
			iteration: 1,
			rawResponse: '{"content": "response"}',
			usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 },
		} as never);

		// storeLlmCall is called fire-and-forget — flush microtasks
		await Promise.resolve();

		expect(mockStoreLlmCall).toHaveBeenCalledOnce();
		expect(mockStoreLlmCall).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: 'run-123',
				callNumber: 1,
				model: 'claude-3-sonnet',
				inputTokens: 100,
				outputTokens: 50,
				costUsd: 0.005,
			}),
		);
	});

	it('does not call storeLlmCall when runId is undefined', async () => {
		const trackingContext = createTrackingContext();
		const hooks = createObserverHooks({
			model: 'claude-3-sonnet',
			logWriter: mockLogWriter,
			trackingContext,
			llmCallLogger: mockLlmCallLogger as never,
			// No runId
		});

		await hooks.onLLMCallReady({
			iteration: 1,
			options: { messages: [], model: 'claude-3-sonnet' },
		} as never);

		await hooks.onLLMCallComplete({
			iteration: 1,
			rawResponse: '{"content": "response"}',
			usage: { inputTokens: 100, outputTokens: 50 },
		} as never);

		await Promise.resolve();
		expect(mockStoreLlmCall).not.toHaveBeenCalled();
	});

	it('does not call storeLlmCall when usage is missing', async () => {
		const trackingContext = createTrackingContext();
		const hooks = createObserverHooks({
			model: 'claude-3-sonnet',
			logWriter: mockLogWriter,
			trackingContext,
			llmCallLogger: mockLlmCallLogger as never,
			runId: 'run-123',
		});

		await hooks.onLLMCallReady({
			iteration: 1,
			options: { messages: [], model: 'claude-3-sonnet' },
		} as never);

		await hooks.onLLMCallComplete({
			iteration: 1,
			rawResponse: '{"content": "response"}',
			// No usage
		} as never);

		await Promise.resolve();
		expect(mockStoreLlmCall).not.toHaveBeenCalled();
	});

	it('captures serialized request and passes to storeLlmCall', async () => {
		const trackingContext = createTrackingContext();
		const hooks = createObserverHooks({
			model: 'claude-3-sonnet',
			logWriter: mockLogWriter,
			trackingContext,
			llmCallLogger: mockLlmCallLogger as never,
			runId: 'run-456',
		});

		const messages = [{ role: 'user', content: 'test message' }];

		await hooks.onLLMCallReady({
			iteration: 1,
			options: { messages, model: 'claude-3-sonnet' },
		} as never);

		await hooks.onLLMCallComplete({
			iteration: 1,
			rawResponse: 'response',
			usage: { inputTokens: 10, outputTokens: 5 },
		} as never);

		await Promise.resolve();

		const callArgs = mockStoreLlmCall.mock.calls[0][0];
		expect(callArgs.request).toBe(JSON.stringify(messages));
	});

	it('does not throw when storeLlmCall rejects (fire-and-forget)', async () => {
		mockStoreLlmCall.mockRejectedValueOnce(new Error('DB connection failed'));
		const trackingContext = createTrackingContext();

		const hooks = createObserverHooks({
			model: 'claude-3-sonnet',
			logWriter: mockLogWriter,
			trackingContext,
			llmCallLogger: mockLlmCallLogger as never,
			runId: 'run-789',
		});

		await hooks.onLLMCallReady({
			iteration: 1,
			options: { messages: [], model: 'claude-3-sonnet' },
		} as never);

		// Should not throw even when storeLlmCall rejects
		await expect(
			hooks.onLLMCallComplete({
				iteration: 1,
				rawResponse: 'response',
				usage: { inputTokens: 10, outputTokens: 5 },
			} as never),
		).resolves.toBeUndefined();

		// Flush the rejected promise
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/llmMetrics.js', () => ({
	calculateCost: vi.fn().mockReturnValue(0.005),
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

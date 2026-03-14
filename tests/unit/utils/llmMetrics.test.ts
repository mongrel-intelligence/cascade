import { describe, expect, it, vi } from 'vitest';
import {
	calculateCost,
	estimateInputTokens,
	logLLMCallStart,
	logLLMMetrics,
} from '../../../src/utils/llmMetrics.js';

describe.concurrent('llmMetrics', () => {
	describe('calculateCost', () => {
		it('calculates cost for known model', () => {
			const cost = calculateCost('gemini:gemini-2.5-flash', {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			// $0.15 input + $0.60 output = $0.75
			expect(cost).toBeCloseTo(0.75, 6);
		});

		it('returns 0 for unknown model', () => {
			const cost = calculateCost('unknown:model', {
				inputTokens: 1000,
				outputTokens: 1000,
			});

			expect(cost).toBe(0);
		});

		it('handles zero tokens', () => {
			const cost = calculateCost('gemini:gemini-2.5-flash', {
				inputTokens: 0,
				outputTokens: 0,
			});

			expect(cost).toBe(0);
		});

		it('applies cached input discount for models that support it', () => {
			// Anthropic Claude Sonnet 4.5: input=$3, output=$15, cachedInput=$0.3
			const costWithCache = calculateCost('anthropic:claude-sonnet-4-5', {
				inputTokens: 1_000_000,
				outputTokens: 500_000,
				cachedInputTokens: 500_000,
			});

			const costWithoutCache = calculateCost('anthropic:claude-sonnet-4-5', {
				inputTokens: 1_000_000,
				outputTokens: 500_000,
				cachedInputTokens: 0,
			});

			// Cached should be cheaper
			expect(costWithCache).toBeLessThan(costWithoutCache);
		});

		it('does not apply cached discount for models without cachedInput pricing', () => {
			const cost = calculateCost('gemini:gemini-2.5-flash', {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cachedInputTokens: 500_000,
			});

			// No cached discount, same as without cached tokens
			expect(cost).toBeCloseTo(0.75, 6);
		});

		it('calculates correct cost for small token counts', () => {
			// 1000 input tokens at $0.15/1M = $0.00015
			// 500 output tokens at $0.60/1M = $0.0003
			const cost = calculateCost('gemini:gemini-2.5-flash', {
				inputTokens: 1000,
				outputTokens: 500,
			});

			expect(cost).toBeCloseTo(0.00015 + 0.0003, 8);
		});
	});

	describe('estimateInputTokens', () => {
		it('estimates tokens from messages', () => {
			const messages = [{ role: 'user', content: 'Hello world' }];
			const estimate = estimateInputTokens(messages);

			// JSON.stringify length / 4, ceiling
			expect(estimate).toBeGreaterThan(0);
			expect(estimate).toBe(Math.ceil(JSON.stringify(messages).length / 4));
		});

		it('handles empty messages array', () => {
			const estimate = estimateInputTokens([]);

			expect(estimate).toBeGreaterThan(0); // [] still has length 2
		});

		it('handles large messages', () => {
			const longContent = 'a'.repeat(4000);
			const messages = [{ role: 'user', content: longContent }];
			const estimate = estimateInputTokens(messages);

			expect(estimate).toBeGreaterThanOrEqual(1000);
		});
	});

	describe('logLLMMetrics', () => {
		it('logs metrics with formatted cost', () => {
			const mockLogger = { info: vi.fn() };

			logLLMMetrics(mockLogger, {
				model: 'test-model',
				iteration: 5,
				inputTokens: 1000,
				outputTokens: 500,
				cachedTokens: 200,
				durationMs: 1500,
				cost: 0.003456,
			});

			expect(mockLogger.info).toHaveBeenCalledWith('LLM call complete', {
				model: 'test-model',
				iteration: 5,
				inputTokens: 1000,
				outputTokens: 500,
				cachedTokens: 200,
				durationMs: 1500,
				cost: '$0.003456',
			});
		});
	});

	describe('logLLMCallStart', () => {
		it('logs call start with estimated tokens and message count', () => {
			const mockLogger = { info: vi.fn() };
			const messages = [
				{ role: 'system', content: 'You are helpful' },
				{ role: 'user', content: 'Hello' },
			];

			logLLMCallStart(mockLogger, 3, messages);

			expect(mockLogger.info).toHaveBeenCalledWith('LLM call starting', {
				iteration: 3,
				estimatedInputTokens: expect.any(Number),
				messageCount: 2,
			});
		});
	});
});

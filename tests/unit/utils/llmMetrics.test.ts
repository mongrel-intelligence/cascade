import { describe, expect, it } from 'vitest';
import { calculateCost } from '../../../src/utils/llmMetrics.js';

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
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockLogger } from '../../helpers/sharedMocks.js';

vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));

const mockCaptureException = vi.fn();
vi.mock('../../../src/sentry.js', () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

import { calculateCost, MODEL_PRICING } from '../../../src/utils/llmMetrics.js';

describe('llmMetrics', () => {
	describe('calculateCost', () => {
		it('calculates cost for known model', () => {
			const cost = calculateCost('gemini:gemini-2.5-flash', {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			// $0.15 input + $0.60 output = $0.75
			expect(cost).toBeCloseTo(0.75, 6);
		});

		it('calculates cost for Claude Opus 5', () => {
			// input=$5, output=$25
			const cost = calculateCost('anthropic:claude-opus-5', {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			expect(cost).toBeCloseTo(30.0, 6);
		});

		it('calculates cost for Claude Sonnet 5', () => {
			// input=$3, output=$15
			const cost = calculateCost('anthropic:claude-sonnet-5', {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			expect(cost).toBeCloseTo(18.0, 6);
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

	describe('calculateCost loud-miss path', () => {
		beforeEach(() => {
			mockLogger.warn.mockClear();
			mockCaptureException.mockClear();
		});

		it('warns and captures Sentry once for a missing pricing row, then returns 0', () => {
			// Unique model name so the module-level dedup Set is not already primed by other tests.
			const cost = calculateCost('unknown-provider:brand-new-model-a', {
				inputTokens: 1000,
				outputTokens: 1000,
			});

			expect(cost).toBe(0);
			expect(mockLogger.warn).toHaveBeenCalledTimes(1);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('unknown-provider:brand-new-model-a'),
			);
			expect(mockCaptureException).toHaveBeenCalledTimes(1);
			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					tags: { source: 'model_pricing_missing' },
					level: 'warning',
					extra: { model: 'unknown-provider:brand-new-model-a' },
				}),
			);
		});

		it('deduplicates the warn/Sentry to once per unique model per process', () => {
			// First call primes the dedup Set (warns), subsequent calls stay silent.
			calculateCost('unknown-provider:brand-new-model-b', {
				inputTokens: 1000,
				outputTokens: 1000,
			});
			mockLogger.warn.mockClear();
			mockCaptureException.mockClear();

			calculateCost('unknown-provider:brand-new-model-b', {
				inputTokens: 2000,
				outputTokens: 2000,
			});

			expect(mockLogger.warn).not.toHaveBeenCalled();
			expect(mockCaptureException).not.toHaveBeenCalled();
		});

		it('does not warn for a legitimate zero-priced row (e.g. huggingface)', () => {
			const cost = calculateCost('huggingface:MiniMaxAI/MiniMax-M2.1', {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			expect(cost).toBe(0);
			expect(mockLogger.warn).not.toHaveBeenCalled();
			expect(mockCaptureException).not.toHaveBeenCalled();
		});
	});

	describe('MODEL_PRICING backfilled rows', () => {
		it('prices bare claude-opus-4-6 (backfilled gap)', () => {
			expect(MODEL_PRICING['anthropic:claude-opus-4-6']).toEqual({
				input: 5.0,
				output: 25.0,
				cachedInput: 0.5,
			});
		});

		it('prices bare claude-haiku-4-5 (backfilled gap)', () => {
			expect(MODEL_PRICING['anthropic:claude-haiku-4-5']).toEqual({
				input: 1.0,
				output: 5.0,
				cachedInput: 0.1,
			});
		});
	});
});

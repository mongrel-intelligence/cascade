import { describe, expect, it } from 'vitest';

import { CODEX_MODEL_IDS } from '../../../src/backends/codex/models.js';
import { calculateCost } from '../../../src/utils/llmMetrics.js';

/**
 * Pricing-table coverage for the Codex engine.
 *
 * If a new Codex model is added to src/backends/codex/models.ts without a
 * matching entry in src/utils/llmMetrics.ts MODEL_PRICING, this test fails
 * loudly with the missing model name — preventing the silent "cost = 0"
 * regression that plagued every Codex run before this fix.
 */
describe('codex pricing coverage', () => {
	for (const modelId of CODEX_MODEL_IDS) {
		it(`has a non-zero pricing row for "${modelId}"`, () => {
			// 1M input + 1M output tokens — any priced model must return > 0.
			const cost = calculateCost(`openai:${modelId}`, {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});
			expect(
				cost,
				`Missing pricing entry for openai:${modelId} in src/utils/llmMetrics.ts. ` +
					`Every Codex model in CODEX_MODEL_IDS must have a pricing row.`,
			).toBeGreaterThan(0);
		});
	}

	it('applies cached-input discount for codex-mini-latest (25% cached, not 10%)', () => {
		// codex-mini-latest published rate is cachedInput=$0.375/1M (25% of $1.50 input)
		// — verify the row preserves this non-standard ratio.
		const noCache = calculateCost('openai:codex-mini-latest', {
			inputTokens: 1_000_000,
			outputTokens: 0,
		});
		const fullCache = calculateCost('openai:codex-mini-latest', {
			inputTokens: 1_000_000,
			outputTokens: 0,
			cachedInputTokens: 1_000_000,
		});
		// Discount = (input - cachedInput) * 1M tokens.
		// If preserved at 25% ratio, discount = (1.50 - 0.375) = $1.125, leaving $0.375 cost.
		expect(fullCache).toBeCloseTo(0.375, 4);
		expect(noCache).toBeCloseTo(1.5, 4);
	});

	it('proxies gpt-5.3-codex-spark to gpt-5.3-codex rates', () => {
		// spark has no metered API listing — we proxy to gpt-5.3-codex rates so
		// ChatGPT Pro users still get an API-equivalent cost figure. If a future
		// commit decouples them, this test alerts the maintainer.
		const codex = calculateCost('openai:gpt-5.3-codex', {
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
		});
		const spark = calculateCost('openai:gpt-5.3-codex-spark', {
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
		});
		expect(spark).toBeCloseTo(codex, 6);
	});

	it('gpt-5.5 has a cachedInput rate (not undefined)', () => {
		// Regression net for the existing gpt-5.5 row that shipped without cachedInput.
		const noCache = calculateCost('openai:gpt-5.5', {
			inputTokens: 1_000_000,
			outputTokens: 0,
		});
		const fullCache = calculateCost('openai:gpt-5.5', {
			inputTokens: 1_000_000,
			outputTokens: 0,
			cachedInputTokens: 1_000_000,
		});
		expect(fullCache).toBeLessThan(noCache);
	});
});

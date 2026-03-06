import { describe, expect, it } from 'vitest';

import { MODEL_RATE_LIMITS, getRateLimitForModel } from '../../../src/config/rateLimits.js';

describe('config/rateLimits', () => {
	describe('getRateLimitForModel', () => {
		it('returns exact match for known models', () => {
			const result = getRateLimitForModel('gemini:gemini-2.5-flash');

			expect(result).toEqual({
				requestsPerMinute: 15,
				tokensPerMinute: 1_000_000,
				tokensPerDay: 1_500_000,
				safetyMargin: 0.8,
			});
		});

		it('returns exact match for Claude Sonnet 4.6', () => {
			const result = getRateLimitForModel('anthropic:claude-sonnet-4-6');

			expect(result).toEqual({
				requestsPerMinute: 50,
				tokensPerMinute: 40_000,
				safetyMargin: 0.9,
			});
		});

		it('returns exact match for Claude Sonnet 4.5', () => {
			const result = getRateLimitForModel('anthropic:claude-sonnet-4-5');

			expect(result).toEqual({
				requestsPerMinute: 50,
				tokensPerMinute: 40_000,
				safetyMargin: 0.9,
			});
		});

		it('returns exact match for Claude Opus 4.5', () => {
			const result = getRateLimitForModel('anthropic:claude-opus-4-5');

			expect(result).toEqual({
				requestsPerMinute: 50,
				tokensPerMinute: 10_000,
				safetyMargin: 0.85,
			});
		});

		it('returns prefix match for models with version suffix', () => {
			// anthropic:claude-sonnet-4-5-20250929 should match anthropic:claude-sonnet-4-5
			const result = getRateLimitForModel('anthropic:claude-sonnet-4-5-20250929');

			expect(result).toEqual({
				requestsPerMinute: 50,
				tokensPerMinute: 40_000,
				safetyMargin: 0.9,
			});
		});

		it('returns disabled config for unknown models', () => {
			const result = getRateLimitForModel('unknown-provider:unknown-model');

			expect(result).toEqual({ enabled: false });
		});

		it('returns disabled config for empty string', () => {
			const result = getRateLimitForModel('');

			expect(result).toEqual({ enabled: false });
		});

		it('returns exact match priority over prefix match', () => {
			// Verify exact match takes precedence
			const exactKey = 'openrouter:google/gemini-3-flash-preview';
			const exactMatch = getRateLimitForModel(exactKey);

			// Should match the exact config, not a generic openrouter prefix
			expect(exactMatch).toEqual(MODEL_RATE_LIMITS[exactKey]);
		});

		it('returns prefix match for OpenRouter models with version suffix', () => {
			// Test that prefix matching works for OpenRouter models
			const result = getRateLimitForModel('openrouter:google/gemini-3-flash-preview-2025');

			// Should match openrouter:google/gemini-3-flash-preview prefix
			expect(result).toEqual({
				requestsPerMinute: 100,
				tokensPerMinute: 500_000,
				safetyMargin: 0.9,
			});
		});

		it('includes all expected config fields', () => {
			const result = getRateLimitForModel('gemini:gemini-2.5-flash');

			expect(result).toHaveProperty('requestsPerMinute');
			expect(result).toHaveProperty('tokensPerMinute');
			expect(result).toHaveProperty('safetyMargin');
			expect(typeof result.requestsPerMinute).toBe('number');
			expect(typeof result.tokensPerMinute).toBe('number');
			expect(typeof result.safetyMargin).toBe('number');
		});

		it('safety margin is between 0 and 1', () => {
			for (const [modelId, config] of Object.entries(MODEL_RATE_LIMITS)) {
				expect(config.safetyMargin).toBeGreaterThan(0);
				expect(config.safetyMargin).toBeLessThanOrEqual(1);
			}
		});
	});

	describe('MODEL_RATE_LIMITS constants', () => {
		it('includes Gemini free tier config', () => {
			expect(MODEL_RATE_LIMITS['gemini:gemini-2.5-flash']).toBeDefined();
			expect(MODEL_RATE_LIMITS['gemini:gemini-2.5-flash'].tokensPerDay).toBe(1_500_000);
		});

		it('includes Claude Sonnet and Opus configs', () => {
			expect(MODEL_RATE_LIMITS['anthropic:claude-sonnet-4-6']).toBeDefined();
			expect(MODEL_RATE_LIMITS['anthropic:claude-sonnet-4-5']).toBeDefined();
			expect(MODEL_RATE_LIMITS['anthropic:claude-opus-4-5']).toBeDefined();
		});

		it('includes OpenRouter models', () => {
			expect(MODEL_RATE_LIMITS['openrouter:google/gemini-3-flash-preview']).toBeDefined();
			expect(MODEL_RATE_LIMITS['openrouter:deepseek/deepseek-chat-v3-0324']).toBeDefined();
			expect(MODEL_RATE_LIMITS['openrouter:x-ai/grok-code-fast-1']).toBeDefined();
		});

		it('all configs have required fields', () => {
			for (const [modelId, config] of Object.entries(MODEL_RATE_LIMITS)) {
				expect(config.requestsPerMinute, `${modelId} missing RPM`).toBeDefined();
				expect(config.tokensPerMinute, `${modelId} missing TPM`).toBeDefined();
				expect(config.safetyMargin, `${modelId} missing safety margin`).toBeDefined();
			}
		});
	});
});

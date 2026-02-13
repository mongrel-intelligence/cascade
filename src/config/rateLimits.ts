import type { RateLimitConfig } from 'llmist';

interface ModelRateLimits {
	[modelPrefix: string]: RateLimitConfig;
}

/**
 * Model-specific rate limit configurations.
 *
 * These limits are based on provider API tiers to prevent 429 errors.
 * CASCADE uses proactive rate limiting to throttle requests before hitting limits.
 */
export const MODEL_RATE_LIMITS: ModelRateLimits = {
	// Gemini free tier (15 RPM, 1M TPM, 1.5M tokens/day)
	'gemini:gemini-2.5-flash': {
		requestsPerMinute: 15,
		tokensPerMinute: 1_000_000,
		tokensPerDay: 1_500_000,
		safetyMargin: 0.8, // Conservative - start throttling at 80%
	},

	// Claude Sonnet 4.5 (Tier 1: 50 RPM, 40K TPM)
	'anthropic:claude-sonnet-4-5': {
		requestsPerMinute: 50,
		tokensPerMinute: 40_000,
		safetyMargin: 0.9,
	},

	// Claude Opus 4.5 (Tier 1: 50 RPM, 10K TPM)
	'anthropic:claude-opus-4-5': {
		requestsPerMinute: 50,
		tokensPerMinute: 10_000,
		safetyMargin: 0.85, // More conservative for expensive model
	},

	// OpenRouter models (generous limits - OpenRouter handles rate limiting)
	'openrouter:google/gemini-3-flash-preview': {
		requestsPerMinute: 100,
		tokensPerMinute: 500_000,
		safetyMargin: 0.9,
	},
	'openrouter:google/gemini-3-pro-preview': {
		requestsPerMinute: 100,
		tokensPerMinute: 500_000,
		safetyMargin: 0.9,
	},
	'openrouter:x-ai/grok-code-fast-1': {
		requestsPerMinute: 100,
		tokensPerMinute: 500_000,
		safetyMargin: 0.9,
	},
	'openrouter:deepseek/deepseek-chat-v3-0324': {
		requestsPerMinute: 100,
		tokensPerMinute: 500_000,
		safetyMargin: 0.9,
	},
	'openrouter:deepseek/deepseek-v3.2': {
		requestsPerMinute: 100,
		tokensPerMinute: 1_000_000,
		safetyMargin: 0.9,
	},
	'openrouter:minimax/minimax-m2.1': {
		requestsPerMinute: 100,
		tokensPerMinute: 500_000,
		safetyMargin: 0.9,
	},
};

/**
 * Get rate limit configuration for a given model.
 *
 * Attempts exact match first, then prefix match (e.g., "gemini:" matches all gemini models).
 * Returns disabled config if no match found.
 *
 * @param model - Model identifier (e.g., "gemini:gemini-2.5-flash")
 * @returns Rate limit configuration
 */
export function getRateLimitForModel(model: string): RateLimitConfig {
	// Try exact match first
	if (MODEL_RATE_LIMITS[model]) {
		return MODEL_RATE_LIMITS[model];
	}

	// Try prefix match (e.g., "gemini:" matches all gemini models)
	for (const [prefix, config] of Object.entries(MODEL_RATE_LIMITS)) {
		if (model.startsWith(prefix)) {
			return config;
		}
	}

	// No match found - return disabled config
	return { enabled: false };
}

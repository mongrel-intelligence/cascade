/**
 * LLM request metrics tracking and logging utilities.
 * Provides cost calculation.
 */
import type { TokenUsage } from 'llmist';

/**
 * Model pricing per 1M tokens (in USD).
 * Prices as of January 2026.
 */
const MODEL_PRICING: Record<string, { input: number; output: number; cachedInput?: number }> = {
	// Anthropic Claude 4 family
	'anthropic:claude-opus-4-8': { input: 5.0, output: 25.0, cachedInput: 0.5 },
	'anthropic:claude-opus-4-8[1m]': { input: 5.0, output: 25.0, cachedInput: 0.5 },
	'anthropic:claude-opus-4-7': { input: 5.0, output: 25.0, cachedInput: 0.5 },
	'anthropic:claude-opus-4-7[1m]': { input: 5.0, output: 25.0, cachedInput: 0.5 },
	'anthropic:claude-opus-4-6[1m]': { input: 5.0, output: 25.0, cachedInput: 0.5 },
	'anthropic:claude-sonnet-4-6': { input: 3.0, output: 15.0, cachedInput: 0.3 },
	'anthropic:claude-sonnet-4-6[1m]': { input: 3.0, output: 15.0, cachedInput: 0.3 },
	'anthropic:claude-sonnet-4-5': { input: 3.0, output: 15.0, cachedInput: 0.3 },
	'anthropic:claude-opus-4-5': { input: 15.0, output: 75.0, cachedInput: 1.5 },
	'anthropic:claude-haiku-3-5': { input: 0.8, output: 4.0, cachedInput: 0.08 },

	// Google Gemini
	'gemini:gemini-2.5-flash': { input: 0.15, output: 0.6 },
	'gemini:gemini-2.5-pro': { input: 1.25, output: 5.0 },

	// OpenAI — Codex CLI models (per developers.openai.com/codex/pricing, 2026-05-11).
	// Rates are public metered API prices; we display API-equivalent cost regardless of
	// subscription plan, consistent with how Anthropic Pro/Max users see costs for claude-code.
	'openai:gpt-5.5': { input: 5.0, output: 30.0, cachedInput: 0.5 },
	'openai:gpt-5.4': { input: 2.5, output: 15.0, cachedInput: 0.25 },
	// gpt-5.4-mini: rates from developers.openai.com/api/docs/models/gpt-5.4-mini (2026-05-11).
	'openai:gpt-5.4-mini': { input: 0.75, output: 4.5, cachedInput: 0.075 },
	'openai:gpt-5.3-codex': { input: 1.75, output: 14.0, cachedInput: 0.175 },
	// gpt-5.3-codex-spark is a ChatGPT Pro research preview with no metered API listing;
	// we proxy to gpt-5.3-codex rates so cost figures stay populated. Update if OpenAI
	// publishes a separate metered rate.
	'openai:gpt-5.3-codex-spark': { input: 1.75, output: 14.0, cachedInput: 0.175 },
	// codex-mini-latest: cachedInput is 25% of input (verified against the OpenAI model
	// doc page), not the standard 10%. Do not "normalise" this row.
	'openai:codex-mini-latest': { input: 1.5, output: 6.0, cachedInput: 0.375 },
	// Non-Codex OpenAI models — kept for completeness of metered LLM coverage.
	'openai:gpt-4o': { input: 2.5, output: 10.0, cachedInput: 1.25 },
	'openai:gpt-4o-mini': { input: 0.15, output: 0.6, cachedInput: 0.075 },

	// HuggingFace (typically free tier or very cheap)
	'huggingface:MiniMaxAI/MiniMax-M2.1': { input: 0, output: 0 },

	// OpenRouter models
	'openrouter:google/gemini-3-flash-preview': { input: 0.5, output: 3.0 },
	'openrouter:google/gemini-3-pro-preview': { input: 2.0, output: 12.0 },
	'openrouter:google/gemini-3.1-pro-preview': { input: 2.0, output: 12.0 },
	'openrouter:google/gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.5 },
	'openrouter:x-ai/grok-code-fast-1': { input: 0.2, output: 1.5 },
	'openrouter:deepseek/deepseek-chat-v3-0324': { input: 0.19, output: 0.87 },
	'openrouter:minimax/minimax-m2.1': { input: 0.28, output: 1.2 },
};

/**
 * Calculate cost for an LLM call based on model and token usage.
 * Returns 0 for unknown models.
 */
export function calculateCost(model: string, usage: TokenUsage): number {
	const pricing = MODEL_PRICING[model];
	if (!pricing) return 0;

	const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
	const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;

	// Cached tokens are billed at a discount (or not at all for some providers)
	const cachedDiscount = pricing.cachedInput
		? ((usage.cachedInputTokens ?? 0) / 1_000_000) * (pricing.input - pricing.cachedInput)
		: 0;

	return inputCost + outputCost - cachedDiscount;
}

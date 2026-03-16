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
	'anthropic:claude-sonnet-4-6': { input: 3.0, output: 15.0, cachedInput: 0.3 },
	'anthropic:claude-sonnet-4-5': { input: 3.0, output: 15.0, cachedInput: 0.3 },
	'anthropic:claude-opus-4-5': { input: 15.0, output: 75.0, cachedInput: 1.5 },
	'anthropic:claude-haiku-3-5': { input: 0.8, output: 4.0, cachedInput: 0.08 },

	// Google Gemini
	'gemini:gemini-2.5-flash': { input: 0.15, output: 0.6 },
	'gemini:gemini-2.5-pro': { input: 1.25, output: 5.0 },

	// OpenAI
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

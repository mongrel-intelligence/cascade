/**
 * LLM request metrics tracking and logging utilities.
 * Provides cost calculation, token estimation, and structured logging.
 */
import type { TokenUsage } from 'llmist';

/**
 * Simple logger interface matching CASCADE's logger.
 */
interface SimpleLogger {
	info(message: string, context?: Record<string, unknown>): void;
}

/**
 * Model pricing per 1M tokens (in USD).
 * Prices as of January 2026.
 */
const MODEL_PRICING: Record<string, { input: number; output: number; cachedInput?: number }> = {
	// Anthropic Claude 4 family
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
	'openrouter:x-ai/grok-code-fast-1': { input: 0.2, output: 1.5 },
	'openrouter:deepseek/deepseek-chat-v3-0324': { input: 0.19, output: 0.87 },
	'openrouter:minimax/minimax-m2.1': { input: 0.28, output: 1.2 },
};

export interface LLMCallMetrics {
	model: string;
	iteration: number;
	inputTokens: number;
	outputTokens: number;
	cachedTokens: number;
	durationMs: number;
	cost: number;
}

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

/**
 * Estimate input token count from messages.
 * Uses rough heuristic of ~4 characters per token.
 */
export function estimateInputTokens(messages: unknown[]): number {
	const text = JSON.stringify(messages);
	return Math.ceil(text.length / 4);
}

/**
 * Log LLM call metrics in a structured format.
 */
export function logLLMMetrics(logger: SimpleLogger, metrics: LLMCallMetrics): void {
	logger.info('LLM call complete', {
		model: metrics.model,
		iteration: metrics.iteration,
		inputTokens: metrics.inputTokens,
		outputTokens: metrics.outputTokens,
		cachedTokens: metrics.cachedTokens,
		durationMs: metrics.durationMs,
		cost: `$${metrics.cost.toFixed(6)}`,
	});
}

/**
 * Log LLM call start with estimated input tokens.
 */
export function logLLMCallStart(
	logger: SimpleLogger,
	iteration: number,
	messages: unknown[],
): void {
	const estimatedInputTokens = estimateInputTokens(messages);
	logger.info('LLM call starting', {
		iteration,
		estimatedInputTokens,
		messageCount: messages.length,
	});
}

/**
 * LLM request metrics tracking and logging utilities.
 * Provides cost calculation.
 */
import type { TokenUsage } from 'llmist';
import { captureException } from '../sentry.js';
import { logger } from './logging.js';

/**
 * Models we've already warned about this process, so a missing-pricing row logs/captures
 * once per unique model instead of on every LLM call/turn. Workers are ephemeral (one job
 * per container), so process-level dedup is the right granularity.
 */
const warnedMissingPricing = new Set<string>();

/**
 * Model pricing per 1M tokens (in USD).
 * Prices as of August 2026.
 */
export const MODEL_PRICING: Record<
	string,
	{ input: number; output: number; cachedInput?: number }
> = {
	// Anthropic Claude Fable 5 — 1M context by default (max = default), priced at 2× Opus.
	// Key matches toPricingKey('claude-fable-5') = 'anthropic:claude-fable-5' (no trailing
	// date to strip). cachedInput follows the 0.1× convention used by every Anthropic row.
	'anthropic:claude-fable-5': { input: 10.0, output: 50.0, cachedInput: 1.0 },

	// Anthropic Claude 5 family
	// Opus 5: mirrors Opus 4.8 pricing; cachedInput follows the 0.1× Anthropic convention.
	'anthropic:claude-opus-5': { input: 5.0, output: 25.0, cachedInput: 0.5 },
	// Sonnet 5: seeded at standard post-intro rates. Intro pricing is $2.00/$10.00 per MTok
	// through 2026-08-31; seeding at standard rates over-reports during the intro window,
	// which is the safe direction for budgets (never under-reports). Revisit before that
	// date if a short-lived intro-rate edit is wanted.
	'anthropic:claude-sonnet-5': { input: 3.0, output: 15.0, cachedInput: 0.3 },

	// Anthropic Claude 4 family
	'anthropic:claude-opus-4-8': { input: 5.0, output: 25.0, cachedInput: 0.5 },
	'anthropic:claude-opus-4-8[1m]': { input: 5.0, output: 25.0, cachedInput: 0.5 },
	'anthropic:claude-opus-4-7': { input: 5.0, output: 25.0, cachedInput: 0.5 },
	'anthropic:claude-opus-4-7[1m]': { input: 5.0, output: 25.0, cachedInput: 0.5 },
	// Bare claude-opus-4-6 backfill (was only present as the [1m] variant, so the bare
	// dropdown ID ran unpriced at $0 — a silent budget bypass). Mirrors the [1m] row.
	'anthropic:claude-opus-4-6': { input: 5.0, output: 25.0, cachedInput: 0.5 },
	'anthropic:claude-opus-4-6[1m]': { input: 5.0, output: 25.0, cachedInput: 0.5 },
	'anthropic:claude-sonnet-4-6': { input: 3.0, output: 15.0, cachedInput: 0.3 },
	'anthropic:claude-sonnet-4-6[1m]': { input: 3.0, output: 15.0, cachedInput: 0.3 },
	'anthropic:claude-sonnet-4-5': { input: 3.0, output: 15.0, cachedInput: 0.3 },
	'anthropic:claude-opus-4-5': { input: 15.0, output: 75.0, cachedInput: 1.5 },
	// Bare claude-haiku-4-5 backfill: claude-haiku-4-5-20251001 is in the dropdown but
	// only claude-haiku-3-5 was priced, so Haiku 4.5 ran unpriced at $0.
	'anthropic:claude-haiku-4-5': { input: 1.0, output: 5.0, cachedInput: 0.1 },
	'anthropic:claude-haiku-3-5': { input: 0.8, output: 4.0, cachedInput: 0.08 },

	// Google Gemini
	'gemini:gemini-2.5-flash': { input: 0.15, output: 0.6 },
	'gemini:gemini-2.5-pro': { input: 1.25, output: 5.0 },

	// OpenAI — Codex CLI models (per developers.openai.com/codex/pricing, 2026-05-11).
	// Rates are public metered API prices; we display API-equivalent cost regardless of
	// subscription plan, consistent with how Anthropic Pro/Max users see costs for claude-code.
	// GPT-5.6 family (GA 2026-07-09, per developers.openai.com/api/docs/pricing): three
	// Sol/Terra/Luna tiers, 1M context on all three, cached-input reads at the standard 90%
	// discount. There is no GPT-5.6 Codex-specific model — Codex runs these same three tiers.
	'openai:gpt-5.6-sol': { input: 5.0, output: 30.0, cachedInput: 0.5 },
	'openai:gpt-5.6-terra': { input: 2.5, output: 15.0, cachedInput: 0.25 },
	'openai:gpt-5.6-luna': { input: 1.0, output: 6.0, cachedInput: 0.1 },
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
	if (!pricing) {
		// A missing pricing row makes calculateCost return 0, which silently disables
		// workItemBudget enforcement for that model (checkBudgetExceeded never trips on a
		// $0 spend). Make the miss loud — but non-fatal: calculateCost is a hot-path pure
		// utility called across all three engines, so throwing would crash runs for any
		// model not yet in MODEL_PRICING. Loud-observe + the drift-guard test is the safer
		// combination. Dedup so it fires once per unique model per process, not per turn.
		if (!warnedMissingPricing.has(model)) {
			warnedMissingPricing.add(model);
			logger.warn(
				`No MODEL_PRICING row for "${model}"; cost reported as $0. This silently disables workItemBudget enforcement for this model — add a pricing row in src/utils/llmMetrics.ts.`,
			);
			captureException(new Error(`Missing MODEL_PRICING row for model "${model}"`), {
				tags: { source: 'model_pricing_missing' },
				level: 'warning',
				extra: { model },
			});
		}
		return 0;
	}

	const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
	const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;

	// Cached tokens are billed at a discount (or not at all for some providers)
	const cachedDiscount = pricing.cachedInput
		? ((usage.cachedInputTokens ?? 0) / 1_000_000) * (pricing.input - pricing.cachedInput)
		: 0;

	return inputCost + outputCost - cachedDiscount;
}

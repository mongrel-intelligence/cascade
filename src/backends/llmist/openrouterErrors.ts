/**
 * OpenRouter error classification for llmist-backed agent runs.
 *
 * Llmist's OpenRouter provider wraps upstream errors with friendly prefixes
 * such as `OpenRouter: Insufficient credits...` (see `enhanceError` in the
 * llmist SDK). These wrapped messages are the most reliable signal that the
 * underlying failure was a provider-side configuration problem rather than a
 * transient runtime issue — none of them are retryable, none are caused by
 * CASCADE bugs, and none should be treated like ordinary agent execution
 * crashes (Sentry tag `agent_execution`).
 *
 * This module exposes:
 *
 *   - `OpenRouterErrorKind` — the actionable categories we care about.
 *   - `classifyOpenRouterError(err)` — returns the kind for any wrapped
 *     OpenRouter error, or `null` for everything else.
 *   - `formatOpenRouterErrorMessage(kind, raw)` — produces the operator-facing
 *     summary written to the run row / PM card.
 *   - `OPENROUTER_ERROR_SENTRY_TAG` / `openRouterErrorSentryTagValue(kind)` —
 *     stable Sentry tag values so credit-exhaustion failures are filterable
 *     and don't drown out real agent crashes.
 *
 * The classifier is intentionally string-based: llmist surfaces the error as a
 * regular `Error` with no preserved status code or provider-specific class,
 * and we never want to crash the worker pipeline because llmist changed the
 * error class hierarchy.
 */

export type OpenRouterErrorKind =
	| 'insufficient_credits'
	| 'rate_limit'
	| 'unauthorized'
	| 'model_unavailable'
	| 'other';

/** Stable Sentry tag name. Used by `captureException({ tags: { source: ... } })`. */
export const OPENROUTER_ERROR_SENTRY_TAG = 'openrouter_provider_error';

/**
 * Map an `OpenRouterErrorKind` to the Sentry `source` tag value.
 *
 * Insufficient-credit failures get their own tag so operator dashboards can
 * filter them out (they are an account / billing problem, not a CASCADE bug).
 */
export function openRouterErrorSentryTagValue(kind: OpenRouterErrorKind): string {
	switch (kind) {
		case 'insufficient_credits':
			return 'openrouter_insufficient_credits';
		case 'rate_limit':
			return 'openrouter_rate_limit';
		case 'unauthorized':
			return 'openrouter_unauthorized';
		case 'model_unavailable':
			return 'openrouter_model_unavailable';
		default:
			return 'openrouter_provider_error';
	}
}

function extractMessage(err: unknown): string | null {
	if (err === null || err === undefined) return null;
	if (typeof err === 'string') return err;
	if (err instanceof Error) return err.message ?? null;
	if (typeof err === 'object' && 'message' in err) {
		const candidate = (err as { message?: unknown }).message;
		if (typeof candidate === 'string') return candidate;
	}
	return null;
}

/**
 * Classify an error originating from llmist's OpenRouter provider.
 *
 * Returns `null` when the error isn't OpenRouter-flavored. The classifier
 * recognizes both:
 *
 *   - llmist's wrapped form: messages starting with `OpenRouter: ...`
 *     (produced by `enhanceError` in `node_modules/llmist`).
 *   - The unwrapped HTTP signals: explicit `402`, `Insufficient credits`,
 *     `429`, `rate limit`, `401`, `Unauthorized`, `503`, etc. Operators may
 *     extend the llmist SDK or swap models in ways that change the wrapping,
 *     so the classifier covers both shapes.
 */
export function classifyOpenRouterError(err: unknown): OpenRouterErrorKind | null {
	const raw = extractMessage(err);
	if (!raw) return null;
	const message = raw.toLowerCase();

	const hasOpenRouterPrefix = message.includes('openrouter:');
	const mentionsCredits =
		message.includes('insufficient credits') ||
		message.includes('insufficient credit') ||
		message.includes('insufficient balance');
	const mentionsPayment = message.includes('402') || message.includes('payment required');

	if (mentionsCredits || (hasOpenRouterPrefix && mentionsPayment)) {
		return 'insufficient_credits';
	}

	// Plain HTTP 402 from any upstream that wasn't wrapped — still a credit /
	// payment failure on the user's side. Treat the same way.
	if (mentionsPayment) {
		return 'insufficient_credits';
	}

	if (!hasOpenRouterPrefix) {
		return null;
	}

	if (message.includes('rate limit') || message.includes('429')) {
		return 'rate_limit';
	}
	if (
		message.includes('authentication failed') ||
		message.includes('unauthorized') ||
		message.includes('401')
	) {
		return 'unauthorized';
	}
	if (
		message.includes('temporarily unavailable') ||
		message.includes('model unavailable') ||
		message.includes('503')
	) {
		return 'model_unavailable';
	}

	return 'other';
}

/**
 * Build an operator-facing summary for a classified OpenRouter error.
 *
 * The summary is what shows up in `AgentResult.error`, which the PM lifecycle
 * surfaces verbatim as `❌ Agent failed: <message>` on the work item. We keep
 * the original llmist message in parentheses so engineers debugging from logs
 * can still see the exact wording that came back from OpenRouter, but lead
 * with a short, plain-English explanation + the actionable next step.
 *
 * Truncates excessively long raw messages so PM cards (especially Trello,
 * which has a 16k comment cap) never break on multi-paragraph payloads.
 */
export function formatOpenRouterErrorMessage(
	kind: OpenRouterErrorKind,
	rawMessage: string | null | undefined,
): string {
	const trimmed = rawMessage ? truncate(rawMessage.trim(), 600) : '';
	const detail = trimmed ? ` (details: ${trimmed})` : '';

	switch (kind) {
		case 'insufficient_credits':
			return (
				`OpenRouter rejected the request because the account has insufficient credits. ` +
				`Top up the OpenRouter balance at https://openrouter.ai/credits or switch the project to a ` +
				`different model/engine before retrying.${detail}`
			);
		case 'rate_limit':
			return (
				`OpenRouter rate-limited the request. Reduce the project's request rate, upgrade the ` +
				`OpenRouter plan, or switch to a different model before retrying.${detail}`
			);
		case 'unauthorized':
			return (
				`OpenRouter rejected the request as unauthorized. Verify the OPENROUTER_API_KEY project ` +
				`credential is current and has access to the configured model.${detail}`
			);
		case 'model_unavailable':
			return (
				`OpenRouter reports the requested model is temporarily unavailable. Switch the project ` +
				`to a different model or retry after the provider recovers.${detail}`
			);
		default:
			return `OpenRouter provider error: the request could not be completed.${detail}`;
	}
}

function truncate(value: string, maxLen: number): string {
	if (value.length <= maxLen) return value;
	return `${value.slice(0, maxLen - 1)}…`;
}

/**
 * Maximum estimated tokens budgeted for the review agent's PR diff context.
 *
 * Applied to compact per-file diffs (not full file contents). Files whose
 * cumulative diff tokens would push the context above this ceiling are
 * surfaced to the agent in a structured `SKIPPED FILES` injection and can
 * be fetched on demand via `Read` or `gh pr diff`.
 */
export const REVIEW_DIFF_CONTEXT_TOKEN_LIMIT = 200_000;

/**
 * Rough token estimation: ~4 characters per token.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

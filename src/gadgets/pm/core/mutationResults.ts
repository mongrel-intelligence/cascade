/**
 * PM mutation result contract — typed outcome/status unions and helpers for
 * normalizing mutation results into a stable shape with `id`, `url`, `status`,
 * and `updatedAt`.
 *
 * Spec MNG-1422: introduces reusable PM mutation result types so later
 * mutation cores (createWorkItem, updateWorkItem, postComment, moveWorkItem,
 * etc.) can return predictable objects instead of free-form prose.
 *
 * Status semantics:
 *   - `'ok'`        — the provider accepted the mutation and we surface its
 *                     fresh `updatedAt`.
 *   - `'no-op'`     — there was nothing to do (e.g. the work item was already
 *                     in the destination state). We synthesize `updatedAt`
 *                     because no provider write happened.
 *   - `'aborted'`   — the mutation was deliberately not attempted (e.g.
 *                     pre-move guard mismatch). Same fallback semantics as
 *                     no-op.
 *
 * Timestamp policy:
 *   - We always PREFER a provider-supplied timestamp when present.
 *   - We ONLY fall back to the current ISO timestamp for synthetic outcomes
 *     (`no-op` / `aborted`). For `'ok'` outcomes the caller MUST pass the
 *     provider timestamp — if the caller has no provider timestamp (legacy
 *     adapter, partial migration), they must request the synthesised fallback
 *     explicitly via `currentTimestamp()` rather than silently pretending
 *     the provider wrote data at "now".
 */

/**
 * Status union for PM mutation outcomes. Stable across all PM mutation
 * gadgets so consumers can branch on shape, not on prose.
 */
export type PMMutationStatus = 'ok' | 'no-op' | 'aborted';

/**
 * Normalized result shape for any PM mutation. Optional fields stay optional
 * — mutations that don't touch a URL or status (e.g. a comment update) just
 * omit those fields rather than carrying empty strings.
 */
export interface PMMutationResult {
	/** Stable identifier of the affected resource (work item ID, comment ID, etc.). */
	id: string;
	/** Outcome status — `'ok'` means the provider wrote data. */
	status: PMMutationStatus;
	/**
	 * ISO 8601 timestamp reflecting when the resource was last updated.
	 * Provider-supplied for `'ok'` outcomes; synthesised via `currentTimestamp()`
	 * for `'no-op'` / `'aborted'` outcomes.
	 */
	updatedAt: string;
	/** Optional URL of the affected resource (work item URL, comment URL, etc.). */
	url?: string;
	/**
	 * Optional human-readable note explaining the outcome (e.g. "already in
	 * destination state"). Consumers can surface this; it's not load-bearing.
	 */
	message?: string;
}

/**
 * Returns the current ISO 8601 timestamp. Used as the fallback for synthetic
 * no-op / aborted outcomes where no provider write happened.
 *
 * Centralized here so tests can spy on it without per-call-site `vi.spyOn`.
 */
export function currentTimestamp(): string {
	return new Date().toISOString();
}

/**
 * Prefer a provider-supplied timestamp, falling back to the current ISO
 * timestamp only when none is available.
 *
 * IMPORTANT: this fallback is intended for synthetic outcomes (no-op,
 * aborted). For `'ok'` outcomes the caller should have a provider timestamp;
 * if it doesn't, it should pass the provider value directly (even if
 * undefined) so the result accurately reflects what the provider returned.
 *
 * The helper exists to avoid littering call sites with the same `?? new
 * Date().toISOString()` expression.
 */
export function pickTimestamp(providerTimestamp: string | undefined | null): string {
	if (providerTimestamp && providerTimestamp.length > 0) {
		return providerTimestamp;
	}
	return currentTimestamp();
}

/**
 * Build an `'ok'` mutation result. Used by mutation cores that successfully
 * wrote data through the provider.
 *
 * The provider timestamp is preferred; the fallback is intentionally
 * synthesised (current ISO) so the consumer always gets a valid ISO string,
 * even from legacy adapters that don't yet plumb `updatedAt`. Downstream
 * consumers should NOT interpret the fallback as a guarantee that the
 * provider write happened at "now" — when accuracy matters, branch on
 * presence of the provider timestamp on the upstream data shape.
 */
export function okResult(args: {
	id: string;
	updatedAt?: string | null;
	url?: string;
	message?: string;
}): PMMutationResult {
	const result: PMMutationResult = {
		id: args.id,
		status: 'ok',
		updatedAt: pickTimestamp(args.updatedAt ?? undefined),
	};
	if (args.url) result.url = args.url;
	if (args.message) result.message = args.message;
	return result;
}

/**
 * Build a `'no-op'` mutation result. Used when the mutation gadget detected
 * that the desired state already holds (e.g. moveWorkItem found the item
 * already in the destination state). The timestamp is the current ISO — no
 * provider write happened, so we never claim a fresh provider timestamp here.
 */
export function noOpResult(args: { id: string; url?: string; message?: string }): PMMutationResult {
	const result: PMMutationResult = {
		id: args.id,
		status: 'no-op',
		updatedAt: currentTimestamp(),
	};
	if (args.url) result.url = args.url;
	if (args.message) result.message = args.message;
	return result;
}

/**
 * Build an `'aborted'` mutation result. Used when a guard refused to attempt
 * the mutation (e.g. expectedSourceState mismatch in moveWorkItem). Same
 * timestamp semantics as no-op — synthesised because no write happened.
 */
export function abortedResult(args: {
	id: string;
	url?: string;
	message?: string;
}): PMMutationResult {
	const result: PMMutationResult = {
		id: args.id,
		status: 'aborted',
		updatedAt: currentTimestamp(),
	};
	if (args.url) result.url = args.url;
	if (args.message) result.message = args.message;
	return result;
}

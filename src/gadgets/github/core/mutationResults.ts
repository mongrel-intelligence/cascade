/**
 * GitHub mutation result contract — typed outcome/status unions and helpers
 * for normalizing GitHub mutation results into a stable shape with `id`,
 * `url`, `status`, and `updatedAt`.
 *
 * Spec MNG-1422: introduces reusable GitHub mutation result types so later
 * mutation cores (createPR, postPRComment, updatePRComment, replyToReviewComment,
 * createPRReview, etc.) can return predictable objects instead of free-form
 * prose.
 *
 * The GitHub helper intentionally mirrors the PM helper at
 * `src/gadgets/pm/core/mutationResults.ts` so consumers can implement a single
 * branching strategy on `status` regardless of the integration. The two
 * modules stay siblings (not a shared utility) because the integration
 * categories themselves are independent — converging the helpers would
 * couple PM and SCM evolution where today they evolve on independent specs.
 *
 * Status semantics:
 *   - `'ok'`        — the mutation succeeded against GitHub. The caller passes
 *                     the provider-reported timestamp (`updated_at` from the
 *                     GitHub REST API response) when available.
 *   - `'no-op'`     — the mutation gadget detected nothing to do (e.g. a PR
 *                     create returning "already exists"). Timestamp is
 *                     synthesised.
 *   - `'aborted'`   — the mutation was deliberately not attempted. Same
 *                     timestamp semantics as no-op.
 *
 * Timestamp policy: identical to the PM helper — provider timestamps win;
 * synthetic timestamps are reserved for synthetic outcomes.
 */

/**
 * Status union for GitHub mutation outcomes. Stable across all GitHub
 * mutation gadgets.
 */
export type GitHubMutationStatus = 'ok' | 'no-op' | 'aborted';

/**
 * Normalized result shape for any GitHub mutation. GitHub resources are
 * universally identified by a numeric ID at the API level; we surface it as
 * a string here to stay consistent with the PM contract and to keep the
 * downstream tool-result schema homogeneous.
 */
export interface GitHubMutationResult {
	/** Stable identifier of the affected resource (PR number, comment ID, etc.) as a string. */
	id: string;
	/** Outcome status — `'ok'` means GitHub accepted the mutation. */
	status: GitHubMutationStatus;
	/**
	 * ISO 8601 timestamp reflecting when the resource was last updated.
	 * GitHub-supplied for `'ok'` outcomes (from the response's `updated_at`);
	 * synthesised via `currentTimestamp()` for `'no-op'` / `'aborted'`
	 * outcomes.
	 */
	updatedAt: string;
	/** Optional URL of the affected resource (PR URL, comment URL). */
	url?: string;
	/** Optional human-readable note explaining the outcome. */
	message?: string;
}

/**
 * Returns the current ISO 8601 timestamp. Used as the fallback for synthetic
 * no-op / aborted outcomes where no GitHub write happened.
 */
export function currentTimestamp(): string {
	return new Date().toISOString();
}

/**
 * Prefer a provider-supplied timestamp, falling back to the current ISO
 * timestamp only when none is available.
 *
 * IMPORTANT: GitHub's REST API always returns `updated_at` on the mutation
 * response, so `'ok'` callers should always have a real value. The fallback
 * exists to keep the helper resilient — never to silently fabricate provider
 * activity.
 */
export function pickTimestamp(providerTimestamp: string | undefined | null): string {
	if (providerTimestamp && providerTimestamp.length > 0) {
		return providerTimestamp;
	}
	return currentTimestamp();
}

/**
 * Build an `'ok'` mutation result. The caller passes the GitHub response's
 * `updated_at` (or equivalent) when available.
 */
export function okResult(args: {
	id: string | number;
	updatedAt?: string | null;
	url?: string;
	message?: string;
}): GitHubMutationResult {
	const result: GitHubMutationResult = {
		id: String(args.id),
		status: 'ok',
		updatedAt: pickTimestamp(args.updatedAt ?? undefined),
	};
	if (args.url) result.url = args.url;
	if (args.message) result.message = args.message;
	return result;
}

/**
 * Build a `'no-op'` mutation result. Used when the gadget detects the
 * desired state already holds (e.g. createPR finds an existing PR for the
 * branch). The timestamp is synthesised because no GitHub write occurred.
 */
export function noOpResult(args: {
	id: string | number;
	url?: string;
	message?: string;
}): GitHubMutationResult {
	const result: GitHubMutationResult = {
		id: String(args.id),
		status: 'no-op',
		updatedAt: currentTimestamp(),
	};
	if (args.url) result.url = args.url;
	if (args.message) result.message = args.message;
	return result;
}

/**
 * Build an `'aborted'` mutation result. Used when a guard refused to attempt
 * the mutation. Timestamp semantics identical to no-op.
 */
export function abortedResult(args: {
	id: string | number;
	url?: string;
	message?: string;
}): GitHubMutationResult {
	const result: GitHubMutationResult = {
		id: String(args.id),
		status: 'aborted',
		updatedAt: currentTimestamp(),
	};
	if (args.url) result.url = args.url;
	if (args.message) result.message = args.message;
	return result;
}

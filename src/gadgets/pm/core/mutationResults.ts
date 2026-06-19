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
 *     provider timestamp. Missing provider timestamps are rejected rather than
 *     silently pretending the provider wrote data at "now".
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
 * aborted). For `'ok'` outcomes the caller must pass a provider timestamp to
 * `okResult`; missing successful-resource timestamps are rejected.
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

function requireProviderTimestamp(updatedAt: string): string {
	if (typeof updatedAt !== 'string' || updatedAt.length === 0) {
		throw new TypeError('okResult requires a provider-supplied updatedAt timestamp');
	}
	return updatedAt;
}

/**
 * Build an `'ok'` mutation result. Used by mutation cores that successfully
 * wrote data through the provider.
 *
 * The provider timestamp is required so consumers can treat `updatedAt` on a
 * successful result as provider-supplied. Synthetic timestamps are reserved
 * for `no-op` and `aborted` results.
 */
export function okResult(args: {
	id: string;
	updatedAt: string;
	url?: string;
	message?: string;
}): PMMutationResult {
	const result: PMMutationResult = {
		id: args.id,
		status: 'ok',
		updatedAt: requireProviderTimestamp(args.updatedAt),
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

// ─── Work-item & comment mutation result contracts (MNG-1423) ───────────────
//
// Work-item and comment mutations expose action-specific outcome statuses
// alongside the parent work-item identity / URL / timestamp. They live in this
// shared module so consumers can import all PM mutation result shapes from a
// single surface; `pickTimestamp` / `currentTimestamp` above are reused as-is.
//
// The acceptance criteria from MNG-1423 use action-specific status literals
// (`created`, `updated`, `moved`, `noop`, `aborted`) instead of the generic
// `'ok' | 'no-op' | 'aborted'` union that the original PM mutation contract
// shipped. The earlier union (re-exported above for parity with the GitHub
// mutation contract) is still useful to callers building their own mutations
// — the explicit literal unions below are what the four work-item / comment
// cores return.

/**
 * Result returned by `createWorkItem`. Surfaces the freshly-created work item's
 * identity (`id`, `title`, `url`), the action status (`'created'`),
 * provider-preferred `updatedAt`, and any workflow-state fields the provider
 * surfaced on creation (`status`, `statusId`). The optional state fields are
 * provider-dependent — Trello returns the destination list ID via `status`,
 * Linear returns the workflow state via `statusId`, JIRA's create endpoint
 * does not surface a status on the create response.
 */
export interface WorkItemCreatedResult {
	status: 'created';
	id: string;
	title: string;
	url: string;
	updatedAt: string;
	/** Optional human-readable workflow state name (e.g. Linear state name). */
	workflowStatus?: string;
	/** Optional native workflow state ID (e.g. Linear state UUID, Trello list ID). */
	workflowStatusId?: string;
}

/**
 * Result returned by `updateWorkItem`. Two outcomes:
 *   - `'updated'` — the provider accepted at least one field update or label
 *     addition. `changedFields` lists the work-item fields that were sent
 *     (any of `'title'` / `'description'`); `addedLabelIds` lists the labels
 *     that were applied. The current work-item metadata (`title`, `url`,
 *     `updatedAt`) is read back from the provider after the mutation.
 *   - `'noop'`    — the caller did not pass any updates (no title,
 *     description, or labels). No provider write happened; `updatedAt` is
 *     synthesised via `currentTimestamp()` and `title` / `url` are best-effort
 *     (read back from the provider when available).
 *
 * `changedFields` and `addedLabelIds` are always present (as arrays) so
 * consumers never branch on `undefined`. They may be empty on the `'noop'`
 * outcome.
 */
export interface WorkItemUpdatedResult {
	status: 'updated' | 'noop';
	id: string;
	title: string;
	url: string;
	updatedAt: string;
	changedFields: Array<'title' | 'description'>;
	addedLabelIds: string[];
	/** Optional human-readable note explaining the outcome (used on `noop`). */
	message?: string;
}

/**
 * Result returned by `moveWorkItem`. Three outcomes:
 *   - `'moved'`   — the provider accepted the move from the caller's source
 *     into the requested destination. The new workflow state is reflected in
 *     `destination` (the value passed to the provider).
 *   - `'noop'`    — the work item was already in the requested destination
 *     (idempotent guard via `expectedSourceState`). No provider write
 *     happened.
 *   - `'aborted'` — the work item's current status did not match
 *     `expectedSourceState` (parallel-agent race guard). No provider write
 *     happened.
 *
 * The work-item `url` is sourced via `provider.getWorkItemUrl(id)` (or the
 * read-back `WorkItem.url` when the guarded path already fetched it). The
 * `previousStatus` field surfaces the work-item's current human-readable
 * workflow status / status ID when the guarded path read it back from the
 * provider — useful for diagnostics on `'noop'` and `'aborted'` outcomes.
 */
export interface WorkItemMovedResult {
	status: 'moved' | 'noop' | 'aborted';
	id: string;
	url: string;
	destination: string;
	updatedAt: string;
	/**
	 * The work item's current status / status ID at the time of the guarded
	 * read-back. Present for `'noop'` and `'aborted'` outcomes (and for
	 * `'moved'` outcomes that went through the guarded path); omitted for
	 * `'moved'` outcomes that bypassed the guard (no `expectedSourceState`).
	 */
	previousStatus?: string;
	/**
	 * The previousStatus's native ID when known (e.g. Linear state UUID,
	 * Trello list ID). Optional; consumers can fall back to `previousStatus`.
	 */
	previousStatusId?: string;
	/** Optional human-readable note explaining the outcome. */
	message?: string;
}

/**
 * Result returned by `postComment`. Two outcomes:
 *   - `'created'` — a new comment was added via `provider.addComment`. `id`
 *     is the new comment's provider ID.
 *   - `'updated'` — an existing progress comment was replaced via
 *     `provider.updateComment`. `id` is the existing comment's provider ID.
 *
 * The parent work-item context (`workItemId`, `workItemUrl`) is always
 * present so downstream consumers can correlate the comment back to its
 * parent. `updatedAt` reflects when the comment was written; because the
 * `PMProvider.addComment` / `updateComment` surface returns only an ID
 * (not the full comment record), we synthesise the timestamp via
 * `currentTimestamp()` — the comment was just written, so the synthetic
 * "now" closely tracks the provider-side reality.
 */
export interface CommentPostedResult {
	status: 'created' | 'updated';
	id: string;
	workItemId: string;
	workItemUrl: string;
	updatedAt: string;
}

// ─── Checklist mutation result contracts (MNG-1424) ─────────────────────────
//
// PM checklist mutations have action-specific outcome statuses (`created`,
// `updated`, `deleted`) rather than the generic `'ok' | 'no-op' | 'aborted'`
// outcomes used for work-item/comment mutations. They live in this shared
// module so consumers can import all PM mutation result shapes from a single
// surface; `pickTimestamp` / `currentTimestamp` above are reused as-is.
//
// Timestamp policy mirrors the parent contract: provider-supplied timestamps
// win when available; we fall back to `currentTimestamp()` only when the
// provider's read-back omits an `updatedAt` (e.g. legacy code paths). The
// mutation itself already succeeded, so the structured result never throws
// just because the timestamp can't be sourced from the provider.

/**
 * Result returned by `addChecklist`. Carries the freshly-created checklist's
 * identity (`checklistId`, `checklistName`), the parent work-item context
 * (`workItemId`, `workItemUrl`), the action status (`'created'`),
 * provider-preferred `updatedAt`, the number of items written, and the per-item
 * IDs the provider surfaced.
 *
 * `itemIds` is best-effort — the inline-description providers (Linear, JIRA)
 * return deterministic hashed IDs from `createChecklistWithItems`, while
 * Trello's native-checklist per-item fallback path does not surface IDs from
 * `addChecklistItem`. The field is always present (as an array) so consumers
 * never branch on `undefined`; it may be empty when the provider did not
 * return IDs.
 */
export interface ChecklistCreatedResult {
	status: 'created';
	checklistId: string;
	checklistName: string;
	workItemId: string;
	workItemUrl: string;
	updatedAt: string;
	itemCount: number;
	itemIds: string[];
}

/**
 * Result returned by `updateChecklistItem`. Surfaces the work-item context
 * (`workItemId`, `workItemUrl`), the affected item ID (`checkItemId`), the
 * resulting boolean state (`complete`), the action status (`'updated'`),
 * and a provider-preferred `updatedAt`. Used by consumers that want to
 * confirm both the request was acknowledged AND the resulting state.
 */
export interface ChecklistItemUpdatedResult {
	status: 'updated';
	workItemId: string;
	workItemUrl: string;
	checkItemId: string;
	complete: boolean;
	updatedAt: string;
}

/**
 * Result returned by `deleteChecklistItem`. Surfaces the work-item context
 * (`workItemId`, `workItemUrl`), the deleted item ID (`checkItemId`), the
 * action status (`'deleted'`), and a provider-preferred `updatedAt`.
 */
export interface ChecklistItemDeletedResult {
	status: 'deleted';
	workItemId: string;
	workItemUrl: string;
	checkItemId: string;
	updatedAt: string;
}

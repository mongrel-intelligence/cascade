import { isTRPCClientError } from '@trpc/client';

/**
 * Pure decision helpers shared by the run-detail page (`/runs/$runId`) and the
 * work-item / PR run-list pages (`/work-items/...`, `/prs/...`).
 *
 * A run row is materialized asynchronously by the worker pipeline, so right
 * after a user navigates to a freshly-dispatched run the backend can still
 * return `NOT_FOUND` (single run) or an empty list (run lists). Rather than
 * flashing a misleading "not found" / "no runs yet" state, the pages poll for a
 * short grace window and show a "starting…" pending state instead.
 *
 * All branching logic lives here — outside React — because the web test suite
 * runs in a node environment with no jsdom, so the logic must be node-testable
 * (mirrors the `computeSummaryStats` pattern in
 * `tests/unit/web/work-item-runs.test.ts`). This module has no React imports and
 * no side effects.
 */

/** Poll interval (ms) while waiting for a not-yet-persisted run/list to appear. */
export const RUN_PENDING_POLL_MS = 3000;

/**
 * Maximum number of NOT_FOUND retries for the single-run query before the page
 * surfaces "not found". `RUN_PENDING_POLL_MS * RUN_PENDING_MAX_RETRIES` ≈ a
 * 60-second grace window.
 */
export const RUN_PENDING_MAX_RETRIES = 20;

/** Poll interval (ms) while at least one run is actively `running`. */
export const RUN_RUNNING_POLL_MS = 5000;

/**
 * Grace window (ms) during which an empty run list is treated as "starting"
 * rather than genuinely empty. Derived from the poll cadence and the retry
 * ceiling so the ~60s window stays a single source of truth.
 */
export const RUN_PENDING_GRACE_MS = RUN_PENDING_POLL_MS * RUN_PENDING_MAX_RETRIES;

/**
 * True only when `error` is a tRPC client error whose `data.code` is
 * `NOT_FOUND`. Returns `false` for every other tRPC code (`BAD_REQUEST`,
 * `FORBIDDEN`, `UNAUTHORIZED`, …), a plain `Error`, `null`/`undefined`, or any
 * non-error value — including a plain object that merely looks like a
 * not-found shape.
 */
export function isNotFoundError(error: unknown): boolean {
	if (!isTRPCClientError(error)) {
		return false;
	}
	const code = (error.data as { code?: string } | null | undefined)?.code;
	return code === 'NOT_FOUND';
}

/** True while `elapsedMs` is still inside the pending grace window. */
function isWithinGrace(elapsedMs: number): boolean {
	return elapsedMs < RUN_PENDING_GRACE_MS;
}

// ─── Single-run detail view ──────────────────────────────────────────────────

export type RunDetailView = 'loading' | 'pending' | 'not-found' | 'error' | 'ready';

export interface RunDetailViewInput {
	/** True once the query has resolved a run object. */
	hasData: boolean;
	/** True once the query has settled into a terminal error (retries exhausted). */
	isError: boolean;
	/** The terminal error (populated when `isError` is true). */
	error: unknown;
	/** Number of failed fetch attempts so far (`0` on the very first fetch). */
	failureCount: number;
	/** Error from the most recent failed attempt (populated while retrying). */
	failureReason: unknown;
}

/**
 * Decides what the single-run page (`/runs/$runId`) should render.
 *
 * - `ready`     — a run object is present (wins even over a later background error).
 * - `not-found` — terminal error whose code is `NOT_FOUND` (the run never appeared).
 * - `error`     — terminal error with any other code / cause.
 * - `pending`   — actively retrying a `NOT_FOUND` within the retry ceiling
 *                 (the run row most likely has not been persisted yet).
 * - `loading`   — first fetch in flight (no failures yet) or any other in-flight state.
 */
export function resolveRunDetailView({
	hasData,
	isError,
	error,
	failureCount,
	failureReason,
}: RunDetailViewInput): RunDetailView {
	// Data present always wins, even if a later background refetch errors.
	if (hasData) {
		return 'ready';
	}

	// Terminal error: retries exhausted, or a non-retryable failure.
	if (isError) {
		return isNotFoundError(error) ? 'not-found' : 'error';
	}

	// Still fetching. Distinguish an active NOT_FOUND retry loop (run not yet
	// persisted) from the very first in-flight fetch.
	if (
		failureCount > 0 &&
		failureCount <= RUN_PENDING_MAX_RETRIES &&
		isNotFoundError(failureReason)
	) {
		return 'pending';
	}

	return 'loading';
}

// ─── Run-list view (work-item + PR pages) ────────────────────────────────────

export type WorkItemRunsView = 'loading' | 'pending' | 'empty' | 'error' | 'ready';

export interface WorkItemRunsViewInput {
	/** True while the first list fetch is in flight. */
	isLoading: boolean;
	/** True when the list query errored. */
	isError: boolean;
	/** True when the query resolved to zero runs. */
	isEmpty: boolean;
	/** Time (ms) elapsed since the page began observing an empty result. */
	elapsedMs: number;
}

/**
 * Decides what the run-list pages (`/work-items/...`, `/prs/...`) should render.
 *
 * - `loading` — the initial fetch is in flight.
 * - `error`   — the query errored.
 * - `ready`   — at least one run is present.
 * - `pending` — empty list but still inside the grace window (run starting).
 * - `empty`   — empty list after the grace window elapsed (genuinely no runs).
 */
export function resolveWorkItemRunsView({
	isLoading,
	isError,
	isEmpty,
	elapsedMs,
}: WorkItemRunsViewInput): WorkItemRunsView {
	if (isLoading) {
		return 'loading';
	}
	if (isError) {
		return 'error';
	}
	if (!isEmpty) {
		return 'ready';
	}
	return isWithinGrace(elapsedMs) ? 'pending' : 'empty';
}

export interface WorkItemRunsRefetchInput {
	/** True when at least one run currently has status `running`. */
	hasRunning: boolean;
	/** True when the query resolved to zero runs. */
	isEmpty: boolean;
	/** Time (ms) elapsed since the page began observing an empty result. */
	elapsedMs: number;
}

/**
 * Refetch cadence for the run-list pages:
 *
 * - `RUN_RUNNING_POLL_MS` (5000) while any run is active.
 * - `RUN_PENDING_POLL_MS` (3000) while the list is empty within the grace window.
 * - `false` otherwise (terminal — stop polling).
 */
export function workItemRunsRefetchInterval({
	hasRunning,
	isEmpty,
	elapsedMs,
}: WorkItemRunsRefetchInput): number | false {
	if (hasRunning) {
		return RUN_RUNNING_POLL_MS;
	}
	if (isEmpty && isWithinGrace(elapsedMs)) {
		return RUN_PENDING_POLL_MS;
	}
	return false;
}

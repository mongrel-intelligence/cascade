import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';

import {
	isNotFoundError,
	isRunActive,
	RUN_PENDING_GRACE_MS,
	RUN_PENDING_MAX_RETRIES,
	RUN_PENDING_POLL_MS,
	RUN_RUNNING_POLL_MS,
	resolveRunDetailView,
	resolveWorkItemRunsView,
	workItemRunsRefetchInterval,
} from '../../../web/src/lib/run-pending.js';

/**
 * Tests for the pure run-pending decision helper.
 *
 * Note: React component rendering tests are not possible in the current test
 * setup (node environment, no jsdom). These tests cover the pure branching
 * logic the run pages depend on, mirroring the style of
 * tests/unit/web/work-item-runs.test.ts.
 */

/** Build a TRPCClientError carrying a given tRPC error code in `data.code`. */
function makeTRPCError(code: string, message = 'trpc error'): TRPCClientError<never> {
	const err = new TRPCClientError(message);
	// The real client populates `data` from the server error envelope; mirror
	// that shape here so the production `isTRPCClientError` guard sees it.
	Object.assign(err, { data: { code } });
	return err;
}

// ─── Exported constants ──────────────────────────────────────────────────────

describe('run-pending constants', () => {
	it('RUN_PENDING_POLL_MS is 3000', () => {
		expect(RUN_PENDING_POLL_MS).toBe(3000);
	});

	it('RUN_PENDING_MAX_RETRIES is 20', () => {
		expect(RUN_PENDING_MAX_RETRIES).toBe(20);
	});

	it('RUN_RUNNING_POLL_MS is 5000', () => {
		expect(RUN_RUNNING_POLL_MS).toBe(5000);
	});

	it('grace window is poll * maxRetries (~60s)', () => {
		expect(RUN_PENDING_GRACE_MS).toBe(RUN_PENDING_POLL_MS * RUN_PENDING_MAX_RETRIES);
		expect(RUN_PENDING_GRACE_MS).toBe(60_000);
	});
});

// ─── isRunActive (MNG-1695) ──────────────────────────────────────────────────

describe('isRunActive', () => {
	it('returns true for running', () => {
		expect(isRunActive('running')).toBe(true);
	});

	it('returns true for queued', () => {
		expect(isRunActive('queued')).toBe(true);
	});

	it('returns false for terminal statuses', () => {
		expect(isRunActive('completed')).toBe(false);
		expect(isRunActive('failed')).toBe(false);
		expect(isRunActive('timed_out')).toBe(false);
	});

	it('returns false for an unknown status', () => {
		expect(isRunActive('')).toBe(false);
		expect(isRunActive('cancelled')).toBe(false);
		expect(isRunActive('whatever')).toBe(false);
	});
});

// ─── isNotFoundError ─────────────────────────────────────────────────────────

describe('isNotFoundError', () => {
	it('returns true for a TRPCClientError whose data.code is NOT_FOUND', () => {
		expect(isNotFoundError(makeTRPCError('NOT_FOUND'))).toBe(true);
	});

	it('returns false for BAD_REQUEST', () => {
		expect(isNotFoundError(makeTRPCError('BAD_REQUEST'))).toBe(false);
	});

	it('returns false for FORBIDDEN', () => {
		expect(isNotFoundError(makeTRPCError('FORBIDDEN'))).toBe(false);
	});

	it('returns false for UNAUTHORIZED', () => {
		expect(isNotFoundError(makeTRPCError('UNAUTHORIZED'))).toBe(false);
	});

	it('returns false for a TRPCClientError with no data', () => {
		expect(isNotFoundError(new TRPCClientError('boom'))).toBe(false);
	});

	it('returns false for a plain Error (even if its message says NOT_FOUND)', () => {
		expect(isNotFoundError(new Error('NOT_FOUND'))).toBe(false);
	});

	it('returns false for null', () => {
		expect(isNotFoundError(null)).toBe(false);
	});

	it('returns false for undefined', () => {
		expect(isNotFoundError(undefined)).toBe(false);
	});

	it('returns false for a plain object that mimics the not-found shape', () => {
		// Not a TRPCClientError instance — the guard must reject it.
		expect(isNotFoundError({ data: { code: 'NOT_FOUND' } })).toBe(false);
	});
});

// ─── resolveRunDetailView ────────────────────────────────────────────────────

describe('resolveRunDetailView', () => {
	const base: {
		hasData: boolean;
		isError: boolean;
		error: unknown;
		failureCount: number;
		failureReason: unknown;
	} = {
		hasData: false,
		isError: false,
		error: null,
		failureCount: 0,
		failureReason: null,
	};

	it('returns ready when data is present', () => {
		expect(resolveRunDetailView({ ...base, hasData: true })).toBe('ready');
	});

	it('returns ready even if a background error is present alongside data', () => {
		expect(
			resolveRunDetailView({
				...base,
				hasData: true,
				isError: true,
				error: makeTRPCError('NOT_FOUND'),
			}),
		).toBe('ready');
	});

	it('returns loading on the first fetch (failureCount 0, no error)', () => {
		expect(resolveRunDetailView(base)).toBe('loading');
	});

	it('returns pending while retrying a NOT_FOUND within the retry ceiling', () => {
		expect(
			resolveRunDetailView({
				...base,
				failureCount: 3,
				failureReason: makeTRPCError('NOT_FOUND'),
			}),
		).toBe('pending');
	});

	it('returns pending at the retry-ceiling boundary', () => {
		expect(
			resolveRunDetailView({
				...base,
				failureCount: RUN_PENDING_MAX_RETRIES,
				failureReason: makeTRPCError('NOT_FOUND'),
			}),
		).toBe('pending');
	});

	it('returns not-found on a terminal NOT_FOUND error', () => {
		expect(
			resolveRunDetailView({
				...base,
				isError: true,
				error: makeTRPCError('NOT_FOUND'),
				failureCount: RUN_PENDING_MAX_RETRIES + 1,
				failureReason: makeTRPCError('NOT_FOUND'),
			}),
		).toBe('not-found');
	});

	it('returns error on a terminal non-NOT_FOUND error', () => {
		expect(
			resolveRunDetailView({
				...base,
				isError: true,
				error: makeTRPCError('INTERNAL_SERVER_ERROR'),
			}),
		).toBe('error');
	});

	it('returns error for a terminal plain Error', () => {
		expect(resolveRunDetailView({ ...base, isError: true, error: new Error('network down') })).toBe(
			'error',
		);
	});

	it('falls back to loading while retrying a non-NOT_FOUND transient error', () => {
		// A transient (non-NOT_FOUND) retry is not the "run not persisted yet"
		// pending state — surface the generic loading state instead.
		expect(
			resolveRunDetailView({
				...base,
				failureCount: 2,
				failureReason: makeTRPCError('INTERNAL_SERVER_ERROR'),
			}),
		).toBe('loading');
	});
});

// ─── resolveWorkItemRunsView ─────────────────────────────────────────────────

describe('resolveWorkItemRunsView', () => {
	const base = {
		isLoading: false,
		isError: false,
		isEmpty: false,
		elapsedMs: 0,
	};

	it('returns loading while isLoading', () => {
		expect(resolveWorkItemRunsView({ ...base, isLoading: true })).toBe('loading');
	});

	it('returns error when isError', () => {
		expect(resolveWorkItemRunsView({ ...base, isError: true })).toBe('error');
	});

	it('returns ready for a non-empty result', () => {
		expect(resolveWorkItemRunsView({ ...base, isEmpty: false })).toBe('ready');
	});

	it('returns pending for an empty result within the grace window', () => {
		expect(resolveWorkItemRunsView({ ...base, isEmpty: true, elapsedMs: 1000 })).toBe('pending');
	});

	it('returns empty for an empty result after the grace window', () => {
		expect(
			resolveWorkItemRunsView({ ...base, isEmpty: true, elapsedMs: RUN_PENDING_GRACE_MS + 1 }),
		).toBe('empty');
	});

	it('treats the grace boundary as elapsed (empty exactly at grace)', () => {
		expect(
			resolveWorkItemRunsView({ ...base, isEmpty: true, elapsedMs: RUN_PENDING_GRACE_MS }),
		).toBe('empty');
		expect(
			resolveWorkItemRunsView({ ...base, isEmpty: true, elapsedMs: RUN_PENDING_GRACE_MS - 1 }),
		).toBe('pending');
	});

	it('prioritizes loading/error over the empty/pending split', () => {
		expect(
			resolveWorkItemRunsView({ ...base, isLoading: true, isEmpty: true, elapsedMs: 1000 }),
		).toBe('loading');
		expect(
			resolveWorkItemRunsView({ ...base, isError: true, isEmpty: true, elapsedMs: 1000 }),
		).toBe('error');
	});
});

// ─── workItemRunsRefetchInterval ─────────────────────────────────────────────

describe('workItemRunsRefetchInterval', () => {
	const base = {
		hasRunning: false,
		isEmpty: false,
		elapsedMs: 0,
	};

	it('returns 5000 (RUN_RUNNING_POLL_MS) while a run is running', () => {
		expect(workItemRunsRefetchInterval({ ...base, hasRunning: true })).toBe(5000);
		expect(workItemRunsRefetchInterval({ ...base, hasRunning: true })).toBe(RUN_RUNNING_POLL_MS);
	});

	it('prioritizes the running cadence even within an empty grace window', () => {
		expect(workItemRunsRefetchInterval({ hasRunning: true, isEmpty: true, elapsedMs: 1000 })).toBe(
			RUN_RUNNING_POLL_MS,
		);
	});

	it('returns RUN_PENDING_POLL_MS while empty within the grace window', () => {
		expect(workItemRunsRefetchInterval({ ...base, isEmpty: true, elapsedMs: 1000 })).toBe(
			RUN_PENDING_POLL_MS,
		);
	});

	it('returns false once the grace window has elapsed', () => {
		expect(
			workItemRunsRefetchInterval({ ...base, isEmpty: true, elapsedMs: RUN_PENDING_GRACE_MS }),
		).toBe(false);
	});

	it('returns false when data is present (non-empty, nothing running)', () => {
		expect(workItemRunsRefetchInterval({ ...base, isEmpty: false })).toBe(false);
	});
});

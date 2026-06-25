/**
 * Pure decision helpers for the Debug Analysis panel
 * (`web/src/components/debug/debug-analysis.tsx`).
 *
 * The panel triggers a debug analysis (a separate worker run) and then polls
 * `trpc.runs.getDebugAnalysisStatus` until the analysis reaches a terminal
 * status. To avoid the "button flickers back the instant the trigger mutation
 * settles" bug (MNG-1668), both the poll cadence and the in-progress flag must
 * stay alive across the gap between "mutation accepted" and "status row observed
 * as running" — and must keep polling until a terminal status is seen.
 *
 * All branching logic lives here — outside React — because the web test suite
 * runs in a node environment with no jsdom, so the logic must be node-testable
 * (mirrors the `run-pending.ts` pattern). This module has no React imports and
 * no side effects.
 */

/** Poll interval (ms) for the debug-analysis status query while in progress. */
export const DEBUG_ANALYSIS_POLL_MS = 5000;

/**
 * Lifecycle status of a run's debug analysis, as reported by
 * `trpc.runs.getDebugAnalysisStatus`. Mirrors the backend union in
 * `src/api/routers/runs.ts` (`getDebugAnalysisStatus`).
 */
export type DebugAnalysisStatus = 'idle' | 'running' | 'completed' | 'failed';

/**
 * True once the analysis has reached a terminal status (`completed` or
 * `failed`). Terminal statuses stop polling and clear the polling-active flag.
 */
export function isTerminalDebugAnalysisStatus(status: DebugAnalysisStatus | undefined): boolean {
	return status === 'completed' || status === 'failed';
}

export interface DebugAnalysisRunningInput {
	/** `triggerMutation.isPending` — the trigger request is in flight. */
	triggerIsPending: boolean;
	/** `triggerMutation.isSuccess` — the trigger request settled successfully. */
	triggerIsSuccess: boolean;
	/** Latest status from the status query (`undefined` before the first read). */
	status: DebugAnalysisStatus | undefined;
}

/**
 * Whether the panel should treat the analysis as actively in progress.
 *
 * Covers three overlapping windows so the in-progress affordance never flickers
 * back between "mutation settled" and "status row observed as running":
 *   - the trigger request is still in flight (`isPending`);
 *   - the trigger just succeeded and the status has not yet reached a terminal
 *     value (`isSuccess && !terminal`) — bridges the enqueue→running gap where
 *     the status row can briefly still read `idle`;
 *   - the status query reports `running`.
 *
 * Equivalent to the acceptance-criteria expression:
 *   `isPending || (isSuccess && status !== 'completed' && status !== 'failed') || status === 'running'`.
 */
export function computeDebugAnalysisRunning({
	triggerIsPending,
	triggerIsSuccess,
	status,
}: DebugAnalysisRunningInput): boolean {
	if (triggerIsPending) {
		return true;
	}
	if (triggerIsSuccess && !isTerminalDebugAnalysisStatus(status)) {
		return true;
	}
	return status === 'running';
}

export interface DebugAnalysisRefetchInput {
	/** Latest status from the status query. */
	status: DebugAnalysisStatus | undefined;
	/**
	 * Polling-active flag set on `triggerMutation` success and cleared once the
	 * status reaches a terminal value. Keeps polling alive across the
	 * trigger→running gap where the status row may still read `idle`.
	 */
	pollingActive: boolean;
}

/**
 * Refetch cadence for the status query:
 *   - `false` once the status is terminal (`completed`/`failed`) — stop polling.
 *   - `DEBUG_ANALYSIS_POLL_MS` while `running` or the polling-active flag is set.
 *   - `false` otherwise (idle and nothing pending).
 *
 * The terminal check is deliberately first so a stale `pollingActive === true`
 * (the clearing effect has not run yet) cannot keep polling a finished analysis.
 */
export function debugAnalysisRefetchInterval({
	status,
	pollingActive,
}: DebugAnalysisRefetchInput): number | false {
	if (isTerminalDebugAnalysisStatus(status)) {
		return false;
	}
	if (status === 'running' || pollingActive) {
		return DEBUG_ANALYSIS_POLL_MS;
	}
	return false;
}

import { eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { debugAnalyses, debugAnalysisStatus } from '../schema/index.js';

// ============================================================================
// Types
// ============================================================================

export interface CreateDebugAnalysisInput {
	analyzedRunId: string;
	debugRunId?: string;
	summary: string;
	issues: string;
	timeline?: string;
	recommendations?: string;
	rootCause?: string;
	severity?: string;
}

export interface DebugAnalysisRunState {
	status: string;
	updatedAt: Date | null;
}

// ============================================================================
// Debug Analysis
// ============================================================================

export async function storeDebugAnalysis(input: CreateDebugAnalysisInput): Promise<string> {
	const db = getDb();
	const [row] = await db
		.insert(debugAnalyses)
		.values({
			analyzedRunId: input.analyzedRunId,
			debugRunId: input.debugRunId,
			summary: input.summary,
			issues: input.issues,
			timeline: input.timeline,
			recommendations: input.recommendations,
			rootCause: input.rootCause,
			severity: input.severity,
		})
		.returning({ id: debugAnalyses.id });
	return row.id;
}

export async function getDebugAnalysisByRunId(analyzedRunId: string) {
	const db = getDb();
	const [row] = await db
		.select()
		.from(debugAnalyses)
		.where(eq(debugAnalyses.analyzedRunId, analyzedRunId));
	return row ?? null;
}

export async function deleteDebugAnalysisByRunId(analyzedRunId: string): Promise<void> {
	const db = getDb();
	await db.delete(debugAnalyses).where(eq(debugAnalyses.analyzedRunId, analyzedRunId));
}

export async function getDebugAnalysisByDebugRunId(debugRunId: string) {
	const db = getDb();
	const [row] = await db
		.select()
		.from(debugAnalyses)
		.where(eq(debugAnalyses.debugRunId, debugRunId));
	return row ?? null;
}

// ============================================================================
// Debug Analysis lifecycle status (durable, cross-process)
// ============================================================================
//
// The analysis runs inside a separate worker container and the debug_analyses
// content row is written only at the end, so this table — written by the worker
// around the analysis (and by the dashboard at trigger time) — is the source of
// truth for the in-progress / failed lifecycle. A present debug_analyses row is
// the `completed` signal; this status row covers `running` and `failed`.

/**
 * A `running` status row older than this is treated as stale — a worker that
 * crashed (OOM/kill) without clearing it — so it no longer reports `running` or
 * blocks a re-trigger. Set comfortably above the global worker timeout
 * (`WORKER_TIMEOUT_MS`, default 30 min) so a legitimately long debug analysis is
 * never misread as dead; mirrors the 2h `DEFAULT_STALE_RUN_THRESHOLD_MS` the
 * runs repository uses for active-run staleness.
 */
export const DEBUG_ANALYSIS_RUNNING_STALE_MS = 2 * 60 * 60 * 1000;

/**
 * Whether a status row represents an analysis that is genuinely still running
 * (status `running` and not stale). A `null` row, a terminal status (`failed`),
 * or a stale `running` row all return `false`.
 */
export function isDebugAnalysisRunActive(state: DebugAnalysisRunState | null): boolean {
	if (!state || state.status !== 'running') return false;
	if (!state.updatedAt) return true;
	return Date.now() - state.updatedAt.getTime() < DEBUG_ANALYSIS_RUNNING_STALE_MS;
}

/** Mark a debug analysis as running (idempotent upsert keyed by analyzed run). */
export async function markDebugAnalysisRunning(analyzedRunId: string): Promise<void> {
	const db = getDb();
	await db
		.insert(debugAnalysisStatus)
		.values({ analyzedRunId, status: 'running', updatedAt: new Date() })
		.onConflictDoUpdate({
			target: debugAnalysisStatus.analyzedRunId,
			set: { status: 'running', updatedAt: new Date() },
		});
}

/** Mark a debug analysis as failed (idempotent upsert keyed by analyzed run). */
export async function markDebugAnalysisFailed(analyzedRunId: string): Promise<void> {
	const db = getDb();
	await db
		.insert(debugAnalysisStatus)
		.values({ analyzedRunId, status: 'failed', updatedAt: new Date() })
		.onConflictDoUpdate({
			target: debugAnalysisStatus.analyzedRunId,
			set: { status: 'failed', updatedAt: new Date() },
		});
}

/**
 * Clear a debug analysis status row. Called on successful completion — the
 * present `debug_analyses` content row is then the `completed` signal.
 */
export async function clearDebugAnalysisStatus(analyzedRunId: string): Promise<void> {
	const db = getDb();
	await db.delete(debugAnalysisStatus).where(eq(debugAnalysisStatus.analyzedRunId, analyzedRunId));
}

/** Read the lifecycle status row for a debug analysis, or null when none exists. */
export async function getDebugAnalysisRunState(
	analyzedRunId: string,
): Promise<DebugAnalysisRunState | null> {
	const db = getDb();
	const [row] = await db
		.select({ status: debugAnalysisStatus.status, updatedAt: debugAnalysisStatus.updatedAt })
		.from(debugAnalysisStatus)
		.where(eq(debugAnalysisStatus.analyzedRunId, analyzedRunId));
	return row ?? null;
}

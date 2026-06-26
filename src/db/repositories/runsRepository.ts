import { and, count, desc, eq, gte, inArray, isNull, type SQL } from 'drizzle-orm';
import { getDb } from '../client.js';
import { agentRuns, prWorkItems } from '../schema/index.js';
import { buildAgentRunWorkItemJoin } from './joinHelpers.js';

// ============================================================================
// Types
// ============================================================================

export interface CreateRunInput {
	projectId: string;
	workItemId?: string;
	prNumber?: number;
	agentType: string;
	engine: string;
	triggerType?: string;
	model?: string;
	maxIterations?: number;
}

export interface CompleteRunInput {
	status: 'completed' | 'failed' | 'timed_out';
	durationMs?: number;
	llmIterations?: number;
	gadgetCalls?: number;
	costUsd?: number;
	success?: boolean;
	error?: string;
	prUrl?: string;
	outputSummary?: string;
}

// ============================================================================
// Shared select object (exported for use by runStatsRepository)
// ============================================================================

/**
 * Shared select object for enriched run queries that join with prWorkItems.
 * Used by getRunById, getRunsByWorkItem, and getRunsForPR to ensure consistent
 * field selection across all enriched run queries.
 */
export const enrichedRunSelect = {
	id: agentRuns.id,
	projectId: agentRuns.projectId,
	workItemId: agentRuns.workItemId,
	prNumber: agentRuns.prNumber,
	agentType: agentRuns.agentType,
	engine: agentRuns.engine,
	triggerType: agentRuns.triggerType,
	status: agentRuns.status,
	model: agentRuns.model,
	maxIterations: agentRuns.maxIterations,
	startedAt: agentRuns.startedAt,
	completedAt: agentRuns.completedAt,
	durationMs: agentRuns.durationMs,
	llmIterations: agentRuns.llmIterations,
	gadgetCalls: agentRuns.gadgetCalls,
	costUsd: agentRuns.costUsd,
	success: agentRuns.success,
	error: agentRuns.error,
	prUrl: agentRuns.prUrl,
	outputSummary: agentRuns.outputSummary,
	jobId: agentRuns.jobId,
	workItemUrl: prWorkItems.workItemUrl,
	workItemTitle: prWorkItems.workItemTitle,
	prTitle: prWorkItems.prTitle,
} as const;

// ============================================================================
// Run status taxonomy (MNG-1695)
// ============================================================================

/**
 * Non-terminal run statuses — single source of truth for "this run is still
 * active". `queued` is a pre-dispatch status written at tRPC trigger time so a
 * manual run appears in the dashboard within ~1s; `running` is the worker-side
 * status written once the agent boots.
 *
 * Capacity math (`agent-type-lock`, `work-item-lock`,
 * `implementation-freshness-gate`) deliberately stays `running`-only — see
 * `countActiveRuns`'s `includeQueued` opt-in. The CONFLICT guard, orphan
 * cleanup, and the frontend treat `queued` as active.
 */
export const ACTIVE_RUN_STATUSES = ['running', 'queued'] as const;

/** True when `status` is a non-terminal (active) run status. */
export function isActiveRunStatus(status: string): boolean {
	return (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}

// ============================================================================
// Run CRUD
// ============================================================================

// Note: The enrichedJoinCondition() helper has been extracted to joinHelpers.ts
// as buildAgentRunWorkItemJoin() for reuse across repositories

export async function createRun(input: CreateRunInput): Promise<string> {
	const db = getDb();
	const [row] = await db
		.insert(agentRuns)
		.values({
			projectId: input.projectId,
			workItemId: input.workItemId,
			prNumber: input.prNumber,
			agentType: input.agentType,
			engine: input.engine,
			triggerType: input.triggerType,
			model: input.model,
			maxIterations: input.maxIterations,
			status: 'running',
		})
		.returning({ id: agentRuns.id });
	return row.id;
}

/**
 * Create a pre-dispatch run row with `status='queued'` (MNG-1695, Improvement B).
 *
 * Called at tRPC trigger time so a manual run is visible in the dashboard within
 * ~1s — long before the worker container boots and flips it to `running` via
 * {@link activateQueuedRun}. Mirrors {@link createRun} but inserts the `queued`
 * status. The caller resolves `engine` with the same `resolveEngineName` resolver
 * `runAgent` uses, so the stored engine matches the eventually-activated run
 * (`activateQueuedRun` never overwrites the `engine` column).
 */
export async function createQueuedRun(input: CreateRunInput): Promise<string> {
	const db = getDb();
	const [row] = await db
		.insert(agentRuns)
		.values({
			projectId: input.projectId,
			workItemId: input.workItemId,
			prNumber: input.prNumber,
			agentType: input.agentType,
			engine: input.engine,
			triggerType: input.triggerType,
			model: input.model,
			maxIterations: input.maxIterations,
			status: 'queued',
		})
		.returning({ id: agentRuns.id });
	return row.id;
}

/**
 * Flip a pre-created `queued` run to `running` (MNG-1695, Improvement B).
 *
 * Guarded on `status='queued'` so a BullMQ second attempt (or any double-fire)
 * is an idempotent no-op that returns `false` — `tryCreateRun` still returns the
 * existing runId in that case. Resets `startedAt` to now() so `durationMs` is
 * measured from worker boot, matching today's semantics (the queued badge shows
 * elapsed-since-trigger until activation). Does NOT touch the `engine` column —
 * the value stored by {@link createQueuedRun} is final.
 *
 * @returns `true` when a `queued` row was flipped to `running`; `false` when no
 *   `queued` row matched (already activated, terminal, or never existed).
 */
export async function activateQueuedRun(runId: string): Promise<boolean> {
	const db = getDb();
	const [updated] = await db
		.update(agentRuns)
		.set({ status: 'running', startedAt: new Date() })
		.where(and(eq(agentRuns.id, runId), eq(agentRuns.status, 'queued')))
		.returning({ id: agentRuns.id });
	return !!updated;
}

/**
 * Mark a still-active (`queued` or `running`) run as terminal (MNG-1695).
 *
 * Used for enqueue-failure rollback (tRPC trigger) and the dispatch compensator
 * fast-path so a pre-created row never leaks as a stuck `queued`/`running` row
 * when the worker never starts. Guarded on `status IN (queued, running)` so it
 * is safe to call even if the run already completed.
 */
export async function failQueuedOrRunningRun(
	runId: string,
	reason: string,
	status: 'failed' | 'timed_out' = 'failed',
): Promise<boolean> {
	const db = getDb();
	const [updated] = await db
		.update(agentRuns)
		.set({ status, completedAt: new Date(), error: reason })
		.where(and(eq(agentRuns.id, runId), inArray(agentRuns.status, ACTIVE_RUN_STATUSES)))
		.returning({ id: agentRuns.id });
	return !!updated;
}

export async function updateRunPRNumber(runId: string, prNumber: number): Promise<void> {
	const db = getDb();
	await db
		.update(agentRuns)
		.set({ prNumber })
		.where(and(eq(agentRuns.id, runId), isNull(agentRuns.prNumber)));
}

export async function updateRunJobId(runId: string, jobId: string): Promise<void> {
	const db = getDb();
	await db.update(agentRuns).set({ jobId }).where(eq(agentRuns.id, runId));
}

/**
 * Spec 018: deferred-fill for plan-resolution fields (model, maxIterations).
 * The run row is created upfront so boot-time failures are visible; these two
 * fields are written later, after `resolvePartialExecutionPlan` succeeds.
 */
export async function updateRunPlanResolution(
	runId: string,
	model: string | undefined,
	maxIterations: number | undefined,
): Promise<void> {
	const db = getDb();
	await db.update(agentRuns).set({ model, maxIterations }).where(eq(agentRuns.id, runId));
}

export async function getRunJobId(runId: string): Promise<string | null> {
	const db = getDb();
	const [row] = await db
		.select({ jobId: agentRuns.jobId })
		.from(agentRuns)
		.where(eq(agentRuns.id, runId));
	return row?.jobId ?? null;
}

export async function completeRun(runId: string, input: CompleteRunInput): Promise<void> {
	const db = getDb();
	await db
		.update(agentRuns)
		.set({
			status: input.status,
			completedAt: new Date(),
			durationMs: input.durationMs,
			llmIterations: input.llmIterations,
			gadgetCalls: input.gadgetCalls,
			costUsd: input.costUsd?.toString(),
			success: input.success,
			error: input.error,
			prUrl: input.prUrl,
			outputSummary: input.outputSummary,
		})
		.where(eq(agentRuns.id, runId));
}

export async function getRunById(runId: string) {
	const db = getDb();
	const rows = await db
		.select(enrichedRunSelect)
		.from(agentRuns)
		.leftJoin(prWorkItems, buildAgentRunWorkItemJoin())
		.where(eq(agentRuns.id, runId));
	return rows[0] ?? null;
}

export async function getRunsByWorkItemId(workItemId: string) {
	const db = getDb();
	return db
		.select()
		.from(agentRuns)
		.where(eq(agentRuns.workItemId, workItemId))
		.orderBy(desc(agentRuns.startedAt));
}

export async function getRunsByProjectId(projectId: string) {
	const db = getDb();
	return db
		.select()
		.from(agentRuns)
		.where(eq(agentRuns.projectId, projectId))
		.orderBy(desc(agentRuns.startedAt));
}

// ============================================================================
// Work-item concurrency
// ============================================================================

/** Safe fallback for non-router callers (dashboard API). 2 hours. */
export const DEFAULT_STALE_RUN_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export interface CountActiveRunsOpts {
	projectId: string;
	workItemId?: string;
	agentType?: string;
	maxAgeMs?: number;
	/**
	 * When `true`, count both `queued` and `running` rows (MNG-1695). Defaults to
	 * `false` so capacity/lock callers (`agent-type-lock`, `work-item-lock`,
	 * `implementation-freshness-gate`) keep their `running`-only semantics. Only
	 * the work-item CONFLICT guard (`hasActiveRunForWorkItem`) opts in.
	 */
	includeQueued?: boolean;
}

/**
 * Unified active-run counter. Replaces the four near-identical
 * countActiveRuns* functions with a single parameterized query.
 */
export async function countActiveRuns(opts: CountActiveRunsOpts): Promise<number> {
	const db = getDb();
	const conditions: SQL[] = [
		eq(agentRuns.projectId, opts.projectId),
		opts.includeQueued
			? inArray(agentRuns.status, ACTIVE_RUN_STATUSES)
			: eq(agentRuns.status, 'running'),
	];
	if (opts.workItemId !== undefined) {
		conditions.push(eq(agentRuns.workItemId, opts.workItemId));
	}
	if (opts.agentType !== undefined) {
		conditions.push(eq(agentRuns.agentType, opts.agentType));
	}
	if (opts.maxAgeMs !== undefined) {
		const cutoff = new Date(Date.now() - opts.maxAgeMs);
		conditions.push(gte(agentRuns.startedAt, cutoff));
	}
	const [row] = await db
		.select({ count: count() })
		.from(agentRuns)
		.where(and(...conditions));
	return row?.count ?? 0;
}

export async function hasActiveRunForWorkItem(
	projectId: string,
	workItemId: string,
	maxAgeMs?: number,
): Promise<boolean> {
	// MNG-1695: a pre-created `queued` row counts as active here so the CONFLICT
	// guard (runs.trigger + runs.retry) blocks a duplicate dispatch on the same
	// work item during the brief queued window.
	return (await countActiveRuns({ projectId, workItemId, maxAgeMs, includeQueued: true })) > 0;
}

export async function failOrphanedRun(
	projectId: string,
	workItemId: string,
	reason: string,
	status: 'failed' | 'timed_out' = 'failed',
	durationMs?: number,
): Promise<string | null> {
	const db = getDb();
	const [row] = await db
		.select({ id: agentRuns.id })
		.from(agentRuns)
		.where(
			and(
				eq(agentRuns.projectId, projectId),
				eq(agentRuns.workItemId, workItemId),
				// MNG-1695: a worker that crashes before activation still has a
				// `queued` row, so orphan cleanup must match both active statuses.
				inArray(agentRuns.status, ACTIVE_RUN_STATUSES),
			),
		)
		.orderBy(desc(agentRuns.startedAt))
		.limit(1);
	if (!row) return null;

	const [updated] = await db
		.update(agentRuns)
		.set({
			status,
			completedAt: new Date(),
			error: reason,
			durationMs,
		})
		.where(and(eq(agentRuns.id, row.id), inArray(agentRuns.status, ACTIVE_RUN_STATUSES)))
		.returning({ id: agentRuns.id });
	return updated?.id ?? null;
}

/**
 * Fail the most recent active run for a project without a workItemId (e.g. GitHub PR runs).
 * Uses projectId + optional agentType + startedAfter to identify the run.
 * Guards on an active status (`queued`/`running`, MNG-1695) so it's safe to call
 * even if the run already completed.
 */
export async function failOrphanedRunFallback(
	projectId: string,
	agentType: string | undefined,
	startedAfter: Date,
	status: 'failed' | 'timed_out',
	reason: string,
	durationMs?: number,
): Promise<string | null> {
	const db = getDb();
	const conditions: SQL[] = [
		eq(agentRuns.projectId, projectId),
		// MNG-1695: match `queued` rows too so a worker that crashes before
		// activation still gets failed.
		inArray(agentRuns.status, ACTIVE_RUN_STATUSES),
		gte(agentRuns.startedAt, startedAfter),
	];
	if (agentType) {
		conditions.push(eq(agentRuns.agentType, agentType));
	}
	const [row] = await db
		.select({ id: agentRuns.id })
		.from(agentRuns)
		.where(and(...conditions))
		.orderBy(desc(agentRuns.startedAt))
		.limit(1);
	if (!row) return null;

	const [updated] = await db
		.update(agentRuns)
		.set({
			status,
			completedAt: new Date(),
			error: reason,
			durationMs,
		})
		.where(and(eq(agentRuns.id, row.id), inArray(agentRuns.status, ACTIVE_RUN_STATUSES)))
		.returning({ id: agentRuns.id });
	return updated?.id ?? null;
}

export async function cancelRunById(runId: string, reason: string): Promise<boolean> {
	const db = getDb();
	const [updated] = await db
		.update(agentRuns)
		.set({
			status: 'failed',
			completedAt: new Date(),
			error: reason,
		})
		.where(and(eq(agentRuns.id, runId), eq(agentRuns.status, 'running')))
		.returning({ id: agentRuns.id });
	return !!updated;
}

// ============================================================================
// Re-exports from domain-focused repositories (for backward compatibility)
// ============================================================================

export type { CreateDebugAnalysisInput, DebugAnalysisRunState } from './debugAnalysisRepository.js';
export {
	clearDebugAnalysisStatus,
	DEBUG_ANALYSIS_RUNNING_STALE_MS,
	deleteDebugAnalysisByRunId,
	getDebugAnalysisByDebugRunId,
	getDebugAnalysisByRunId,
	getDebugAnalysisRunState,
	isDebugAnalysisRunActive,
	markDebugAnalysisFailed,
	markDebugAnalysisRunning,
	storeDebugAnalysis,
} from './debugAnalysisRepository.js';
export type { LlmCallRecord } from './llmCallsRepository.js';
export {
	getLlmCallByNumber,
	getLlmCallsByRunId,
	listLlmCallsMeta,
	storeLlmCall,
	storeLlmCallsBulk,
} from './llmCallsRepository.js';

export { getRunLogs, storeRunLogs } from './runLogsRepository.js';

export type {
	AgentTypeBreakdown,
	AggregatedProjectStats,
	AggregatedStatsSummary,
	GetProjectWorkStatsOptions,
	ListRunsInput,
	ProjectWorkStat,
} from './runStatsRepository.js';
export {
	getProjectWorkStats,
	getProjectWorkStatsAggregated,
	getRunsByWorkItem,
	getRunsForPR,
	listProjectsForOrg,
	listRuns,
} from './runStatsRepository.js';

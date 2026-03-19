import { type SQL, and, count, desc, eq, gte, isNull } from 'drizzle-orm';
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
}

/**
 * Unified active-run counter. Replaces the four near-identical
 * countActiveRuns* functions with a single parameterized query.
 */
export async function countActiveRuns(opts: CountActiveRunsOpts): Promise<number> {
	const db = getDb();
	const conditions: SQL[] = [
		eq(agentRuns.projectId, opts.projectId),
		eq(agentRuns.status, 'running'),
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
	return (await countActiveRuns({ projectId, workItemId, maxAgeMs })) > 0;
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
				eq(agentRuns.status, 'running'),
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
		.where(and(eq(agentRuns.id, row.id), eq(agentRuns.status, 'running')))
		.returning({ id: agentRuns.id });
	return updated?.id ?? null;
}

/**
 * Fail the most recent running run for a project without a workItemId (e.g. GitHub PR runs).
 * Uses projectId + optional agentType + startedAfter to identify the run.
 * Guards on status='running' so it's safe to call even if the run already completed.
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
		eq(agentRuns.status, 'running'),
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
		.where(and(eq(agentRuns.id, row.id), eq(agentRuns.status, 'running')))
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

export type { LlmCallRecord } from './llmCallsRepository.js';
export {
	getLlmCallByNumber,
	getLlmCallsByRunId,
	listLlmCallsMeta,
	storeLlmCall,
	storeLlmCallsBulk,
} from './llmCallsRepository.js';

export type { CreateDebugAnalysisInput } from './debugAnalysisRepository.js';
export {
	deleteDebugAnalysisByRunId,
	getDebugAnalysisByDebugRunId,
	getDebugAnalysisByRunId,
	storeDebugAnalysis,
} from './debugAnalysisRepository.js';

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

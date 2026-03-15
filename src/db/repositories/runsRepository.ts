import { type SQL, and, asc, count, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { getDb } from '../client.js';
import {
	agentRunLlmCalls,
	agentRunLogs,
	agentRuns,
	debugAnalyses,
	organizations,
	prWorkItems,
	projects,
} from '../schema/index.js';
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

export interface LlmCallRecord {
	runId: string;
	callNumber: number;
	request?: string;
	response?: string;
	inputTokens?: number;
	outputTokens?: number;
	cachedTokens?: number;
	costUsd?: number;
	durationMs?: number;
	model?: string;
}

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

// ============================================================================
// Run CRUD
// ============================================================================

// Note: The enrichedJoinCondition() helper has been extracted to joinHelpers.ts
// as buildAgentRunWorkItemJoin() for reuse across repositories

/**
 * Shared select object for enriched run queries that join with prWorkItems.
 * Used by getRunById, getRunsByWorkItem, and getRunsForPR to ensure consistent
 * field selection across all enriched run queries.
 */
const enrichedRunSelect = {
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
// Log Storage
// ============================================================================

export async function storeRunLogs(
	runId: string,
	cascadeLog?: string,
	engineLog?: string,
): Promise<void> {
	const db = getDb();
	await db.insert(agentRunLogs).values({
		runId,
		cascadeLog: cascadeLog ?? null,
		engineLog: engineLog ?? null,
	});
}

export async function getRunLogs(runId: string) {
	const db = getDb();
	const [row] = await db.select().from(agentRunLogs).where(eq(agentRunLogs.runId, runId));
	return row ?? null;
}

// ============================================================================
// LLM Call Storage
// ============================================================================

export async function storeLlmCall(call: LlmCallRecord): Promise<void> {
	const db = getDb();
	await db.insert(agentRunLlmCalls).values({
		runId: call.runId,
		callNumber: call.callNumber,
		request: call.request,
		response: call.response,
		inputTokens: call.inputTokens,
		outputTokens: call.outputTokens,
		cachedTokens: call.cachedTokens,
		costUsd: call.costUsd?.toString(),
		durationMs: call.durationMs,
		model: call.model,
	});
}

export async function storeLlmCallsBulk(calls: LlmCallRecord[]): Promise<void> {
	if (calls.length === 0) return;
	const db = getDb();
	await db.insert(agentRunLlmCalls).values(
		calls.map((c) => ({
			runId: c.runId,
			callNumber: c.callNumber,
			request: c.request,
			response: c.response,
			inputTokens: c.inputTokens,
			outputTokens: c.outputTokens,
			cachedTokens: c.cachedTokens,
			costUsd: c.costUsd?.toString(),
			durationMs: c.durationMs,
			model: c.model,
		})),
	);
}

export async function getLlmCallsByRunId(runId: string) {
	const db = getDb();
	return db
		.select()
		.from(agentRunLlmCalls)
		.where(eq(agentRunLlmCalls.runId, runId))
		.orderBy(agentRunLlmCalls.callNumber);
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
			status: 'failed',
			completedAt: new Date(),
			error: reason,
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
// Dashboard queries
// ============================================================================

export interface ListRunsInput {
	orgId?: string;
	projectId?: string;
	status?: string[];
	agentType?: string;
	startedAfter?: Date;
	startedBefore?: Date;
	limit: number;
	offset: number;
	sort?: 'startedAt' | 'durationMs' | 'costUsd';
	order?: 'asc' | 'desc';
}

export async function listRuns(input: ListRunsInput) {
	const db = getDb();

	const conditions: SQL[] = [];

	if (input.orgId) {
		conditions.push(eq(projects.orgId, input.orgId));
	}
	if (input.projectId) {
		conditions.push(eq(agentRuns.projectId, input.projectId));
	}
	if (input.status && input.status.length > 0) {
		conditions.push(inArray(agentRuns.status, input.status));
	}
	if (input.agentType) {
		conditions.push(eq(agentRuns.agentType, input.agentType));
	}
	if (input.startedAfter) {
		conditions.push(gte(agentRuns.startedAt, input.startedAfter));
	}
	if (input.startedBefore) {
		conditions.push(lte(agentRuns.startedAt, input.startedBefore));
	}

	const where = and(...conditions);

	const sortColumn =
		input.sort === 'durationMs'
			? agentRuns.durationMs
			: input.sort === 'costUsd'
				? agentRuns.costUsd
				: agentRuns.startedAt;
	const orderFn = input.order === 'asc' ? asc : desc;

	const [data, [{ total }]] = await Promise.all([
		db
			.select({
				id: agentRuns.id,
				projectId: agentRuns.projectId,
				projectName: projects.name,
				orgId: projects.orgId,
				orgName: organizations.name,
				workItemId: agentRuns.workItemId,
				prNumber: agentRuns.prNumber,
				agentType: agentRuns.agentType,
				engine: agentRuns.engine,
				triggerType: agentRuns.triggerType,
				status: agentRuns.status,
				model: agentRuns.model,
				startedAt: agentRuns.startedAt,
				completedAt: agentRuns.completedAt,
				durationMs: agentRuns.durationMs,
				llmIterations: agentRuns.llmIterations,
				gadgetCalls: agentRuns.gadgetCalls,
				costUsd: agentRuns.costUsd,
				success: agentRuns.success,
				prUrl: agentRuns.prUrl,
				workItemUrl: prWorkItems.workItemUrl,
				workItemTitle: prWorkItems.workItemTitle,
				prTitle: prWorkItems.prTitle,
			})
			.from(agentRuns)
			.innerJoin(projects, eq(agentRuns.projectId, projects.id))
			.innerJoin(organizations, eq(projects.orgId, organizations.id))
			.leftJoin(prWorkItems, buildAgentRunWorkItemJoin())
			.where(where)
			.orderBy(orderFn(sortColumn))
			.limit(input.limit)
			.offset(input.offset),
		db
			.select({ total: count() })
			.from(agentRuns)
			.innerJoin(projects, eq(agentRuns.projectId, projects.id))
			.where(where),
	]);

	return { data, total };
}

export async function getLlmCallByNumber(runId: string, callNumber: number) {
	const db = getDb();
	const [row] = await db
		.select()
		.from(agentRunLlmCalls)
		.where(and(eq(agentRunLlmCalls.runId, runId), eq(agentRunLlmCalls.callNumber, callNumber)));
	return row ?? null;
}

export async function listLlmCallsMeta(runId: string) {
	const db = getDb();
	return db
		.select({
			id: agentRunLlmCalls.id,
			runId: agentRunLlmCalls.runId,
			callNumber: agentRunLlmCalls.callNumber,
			inputTokens: agentRunLlmCalls.inputTokens,
			outputTokens: agentRunLlmCalls.outputTokens,
			cachedTokens: agentRunLlmCalls.cachedTokens,
			costUsd: agentRunLlmCalls.costUsd,
			durationMs: agentRunLlmCalls.durationMs,
			model: agentRunLlmCalls.model,
			createdAt: agentRunLlmCalls.createdAt,
		})
		.from(agentRunLlmCalls)
		.where(eq(agentRunLlmCalls.runId, runId))
		.orderBy(agentRunLlmCalls.callNumber);
}

export async function listProjectsForOrg(orgId: string) {
	const db = getDb();
	return db
		.select({ id: projects.id, name: projects.name })
		.from(projects)
		.where(eq(projects.orgId, orgId));
}

// ============================================================================
// Work-item / PR filtered run queries
// ============================================================================

/**
 * Returns all runs for a specific work item (by workItemId) within a project,
 * enriched with PR work item display info via LEFT JOIN.
 */
export async function getRunsByWorkItem(projectId: string, workItemId: string) {
	const db = getDb();
	return db
		.select(enrichedRunSelect)
		.from(agentRuns)
		.leftJoin(prWorkItems, buildAgentRunWorkItemJoin())
		.where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.workItemId, workItemId)))
		.orderBy(asc(agentRuns.startedAt));
}

/**
 * Returns all runs for a specific PR within a project,
 * enriched with PR work item display info via LEFT JOIN.
 */
export async function getRunsForPR(projectId: string, prNumber: number) {
	const db = getDb();
	return db
		.select(enrichedRunSelect)
		.from(agentRuns)
		.leftJoin(prWorkItems, buildAgentRunWorkItemJoin())
		.where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.prNumber, prNumber)))
		.orderBy(asc(agentRuns.startedAt));
}

// ============================================================================
// Project-level stats (for Work tab aggregate charts)
// ============================================================================

export interface ProjectWorkStat {
	agentType: string;
	status: string;
	durationMs: number | null;
	costUsd: string | null;
	model: string | null;
	startedAt: Date | null;
}

export interface GetProjectWorkStatsOptions {
	dateFrom?: Date;
	agentType?: string;
	status?: string;
}

/**
 * Returns lightweight per-run stats for a project's completed/failed/timed_out runs,
 * ordered by startedAt DESC. Used for client-side chart aggregation on the Stats tab.
 *
 * Limits to the 500 most-recent runs to avoid performance issues on large projects.
 * Optional filters: dateFrom (startedAt >= dateFrom), agentType, status.
 */
export async function getProjectWorkStats(
	projectId: string,
	opts?: GetProjectWorkStatsOptions,
): Promise<ProjectWorkStat[]> {
	const db = getDb();
	const conditions: SQL[] = [
		eq(agentRuns.projectId, projectId),
		inArray(agentRuns.status, ['completed', 'failed', 'timed_out']),
	];
	if (opts?.dateFrom) {
		conditions.push(gte(agentRuns.startedAt, opts.dateFrom));
	}
	if (opts?.agentType) {
		conditions.push(eq(agentRuns.agentType, opts.agentType));
	}
	if (opts?.status) {
		conditions.push(eq(agentRuns.status, opts.status));
	}
	return db
		.select({
			agentType: agentRuns.agentType,
			status: agentRuns.status,
			durationMs: agentRuns.durationMs,
			costUsd: agentRuns.costUsd,
			model: agentRuns.model,
			startedAt: agentRuns.startedAt,
		})
		.from(agentRuns)
		.where(and(...conditions))
		.orderBy(desc(agentRuns.startedAt))
		.limit(500);
}

// ============================================================================
// Aggregated project stats (for Stats tab — server-side aggregation)
// ============================================================================

export interface AggregatedStatsSummary {
	totalRuns: number;
	completedRuns: number;
	failedRuns: number;
	timedOutRuns: number;
	totalCostUsd: string;
	avgDurationMs: number | null;
	successRate: number;
}

export interface AgentTypeBreakdown {
	agentType: string;
	runCount: number;
	totalCostUsd: string;
	totalDurationMs: number;
	avgDurationMs: number | null;
}

export interface AggregatedProjectStats {
	summary: AggregatedStatsSummary;
	byAgentType: AgentTypeBreakdown[];
}

/**
 * Returns pre-aggregated stats for a project's completed/failed/timed_out runs.
 * Performs a single SQL query with GROUP BY agent_type to return both the
 * per-agent breakdown and an overall summary, eliminating client-side aggregation.
 *
 * Limits to the 500 most-recent rows (via subquery) to match the scope of the
 * existing getProjectWorkStats function.
 * Optional filters: dateFrom (startedAt >= dateFrom), agentType, status.
 */
export async function getProjectWorkStatsAggregated(
	projectId: string,
	opts?: GetProjectWorkStatsOptions,
): Promise<AggregatedProjectStats> {
	const db = getDb();

	// Build the same filter conditions as getProjectWorkStats
	const conditions: SQL[] = [
		eq(agentRuns.projectId, projectId),
		inArray(agentRuns.status, ['completed', 'failed', 'timed_out']),
	];
	if (opts?.dateFrom) {
		conditions.push(gte(agentRuns.startedAt, opts.dateFrom));
	}
	if (opts?.agentType) {
		conditions.push(eq(agentRuns.agentType, opts.agentType));
	}
	if (opts?.status) {
		conditions.push(eq(agentRuns.status, opts.status));
	}

	// Subquery limiting to 500 most recent rows, then aggregate by agent_type
	const subquery = db
		.select({
			agentType: agentRuns.agentType,
			status: agentRuns.status,
			durationMs: agentRuns.durationMs,
			costUsd: agentRuns.costUsd,
		})
		.from(agentRuns)
		.where(and(...conditions))
		.orderBy(desc(agentRuns.startedAt))
		.limit(500)
		.as('recent_runs');

	const rows = await db
		.select({
			agentType: subquery.agentType,
			runCount: sql<number>`count(*)::int`,
			completedCount: sql<number>`count(*) filter (where ${subquery.status} = 'completed')::int`,
			failedCount: sql<number>`count(*) filter (where ${subquery.status} = 'failed')::int`,
			timedOutCount: sql<number>`count(*) filter (where ${subquery.status} = 'timed_out')::int`,
			totalCostUsd: sql<string>`coalesce(sum(${subquery.costUsd}::numeric), 0)::text`,
			totalDurationMs: sql<number>`coalesce(sum(${subquery.durationMs}), 0)::int`,
			avgDurationMs: sql<
				number | null
			>`case when count(*) filter (where ${subquery.durationMs} is not null and ${subquery.durationMs} > 0) > 0 then (sum(${subquery.durationMs}) filter (where ${subquery.durationMs} is not null and ${subquery.durationMs} > 0) / count(*) filter (where ${subquery.durationMs} is not null and ${subquery.durationMs} > 0))::int else null end`,
		})
		.from(subquery)
		.groupBy(subquery.agentType);

	// Build per-agent breakdown
	const byAgentType: AgentTypeBreakdown[] = rows.map((row) => ({
		agentType: row.agentType,
		runCount: row.runCount,
		totalCostUsd: row.totalCostUsd,
		totalDurationMs: row.totalDurationMs,
		avgDurationMs: row.avgDurationMs,
	}));

	// Compute overall summary from per-agent rows
	let totalRuns = 0;
	let completedRuns = 0;
	let failedRuns = 0;
	let timedOutRuns = 0;
	let totalCostNum = 0;
	let weightedDurationSum = 0;
	let durationCount = 0;

	for (const row of rows) {
		totalRuns += row.runCount;
		completedRuns += row.completedCount;
		failedRuns += row.failedCount;
		timedOutRuns += row.timedOutCount;
		totalCostNum += Number.parseFloat(row.totalCostUsd);
		if (row.avgDurationMs !== null && row.avgDurationMs > 0) {
			const runsWithDuration = row.runCount; // approximate — actual count from avgDurationMs
			weightedDurationSum += row.totalDurationMs;
			durationCount += runsWithDuration;
		}
	}

	const avgDurationMs = durationCount > 0 ? Math.round(weightedDurationSum / durationCount) : null;
	const successRate = totalRuns > 0 ? (completedRuns / totalRuns) * 100 : 0;

	const summary: AggregatedStatsSummary = {
		totalRuns,
		completedRuns,
		failedRuns,
		timedOutRuns,
		totalCostUsd: totalCostNum.toFixed(4),
		avgDurationMs,
		successRate,
	};

	return { summary, byAgentType };
}

import { and, asc, count, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import { getDb } from '../client.js';
import { agentRuns, organizations, projects, prWorkItems } from '../schema/index.js';
import { buildAgentRunWorkItemJoin } from './joinHelpers.js';

// ============================================================================
// Shared enriched select (mirrors runsRepository.enrichedRunSelect to avoid
// circular dependency — runsRepository re-exports from this file)
// ============================================================================

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

// ============================================================================
// Types
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

// ============================================================================
// Dashboard queries
// ============================================================================

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
			durationRunCount: sql<number>`count(*) filter (where ${subquery.durationMs} is not null and ${subquery.durationMs} > 0)::int`,
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
		if (row.durationRunCount > 0) {
			weightedDurationSum += row.totalDurationMs;
			durationCount += row.durationRunCount;
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

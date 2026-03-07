import { type SQL, and, asc, count, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { getDb } from '../client.js';
import {
	agentRunLlmCalls,
	agentRunLogs,
	agentRuns,
	debugAnalyses,
	projects,
} from '../schema/index.js';

// ============================================================================
// Types
// ============================================================================

export interface CreateRunInput {
	projectId: string;
	cardId?: string;
	prNumber?: number;
	agentType: string;
	backend: string;
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

export async function createRun(input: CreateRunInput): Promise<string> {
	const db = getDb();
	const [row] = await db
		.insert(agentRuns)
		.values({
			projectId: input.projectId,
			cardId: input.cardId,
			prNumber: input.prNumber,
			agentType: input.agentType,
			backend: input.backend,
			triggerType: input.triggerType,
			model: input.model,
			maxIterations: input.maxIterations,
			status: 'running',
		})
		.returning({ id: agentRuns.id });
	return row.id;
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
	const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
	return row ?? null;
}

export async function getRunsByCardId(cardId: string) {
	const db = getDb();
	return db
		.select()
		.from(agentRuns)
		.where(eq(agentRuns.cardId, cardId))
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
	llmistLog?: string,
): Promise<void> {
	const db = getDb();
	await db.insert(agentRunLogs).values({
		runId,
		cascadeLog: cascadeLog ?? null,
		llmistLog: llmistLog ?? null,
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

export async function hasActiveRunForWorkItem(
	projectId: string,
	cardId: string,
	maxAgeMs?: number,
): Promise<boolean> {
	const db = getDb();
	const conditions = [
		eq(agentRuns.projectId, projectId),
		eq(agentRuns.cardId, cardId),
		eq(agentRuns.status, 'running'),
	];
	if (maxAgeMs !== undefined) {
		const cutoff = new Date(Date.now() - maxAgeMs);
		conditions.push(gte(agentRuns.startedAt, cutoff));
	}
	const [row] = await db
		.select({ id: agentRuns.id })
		.from(agentRuns)
		.where(and(...conditions))
		.limit(1);
	return !!row;
}

export async function countActiveRunsForAgentType(
	projectId: string,
	agentType: string,
	maxAgeMs?: number,
): Promise<number> {
	const db = getDb();
	const conditions: SQL[] = [
		eq(agentRuns.projectId, projectId),
		eq(agentRuns.agentType, agentType),
		eq(agentRuns.status, 'running'),
	];
	if (maxAgeMs !== undefined) {
		const cutoff = new Date(Date.now() - maxAgeMs);
		conditions.push(gte(agentRuns.startedAt, cutoff));
	}
	const [row] = await db
		.select({ count: count() })
		.from(agentRuns)
		.where(and(...conditions));
	return row?.count ?? 0;
}

export async function countActiveRunsForWorkItem(
	projectId: string,
	cardId: string,
	maxAgeMs?: number,
): Promise<number> {
	const db = getDb();
	const conditions: SQL[] = [
		eq(agentRuns.projectId, projectId),
		eq(agentRuns.cardId, cardId),
		eq(agentRuns.status, 'running'),
	];
	if (maxAgeMs !== undefined) {
		const cutoff = new Date(Date.now() - maxAgeMs);
		conditions.push(gte(agentRuns.startedAt, cutoff));
	}
	const [row] = await db
		.select({ count: count() })
		.from(agentRuns)
		.where(and(...conditions));
	return row?.count ?? 0;
}

export async function countActiveRunsForWorkItemAndType(
	projectId: string,
	cardId: string,
	agentType: string,
	maxAgeMs?: number,
): Promise<number> {
	const db = getDb();
	const conditions: SQL[] = [
		eq(agentRuns.projectId, projectId),
		eq(agentRuns.cardId, cardId),
		eq(agentRuns.agentType, agentType),
		eq(agentRuns.status, 'running'),
	];
	if (maxAgeMs !== undefined) {
		const cutoff = new Date(Date.now() - maxAgeMs);
		conditions.push(gte(agentRuns.startedAt, cutoff));
	}
	const [row] = await db
		.select({ count: count() })
		.from(agentRuns)
		.where(and(...conditions));
	return row?.count ?? 0;
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
				eq(agentRuns.cardId, workItemId),
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
	orgId: string;
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

	const conditions: SQL[] = [eq(projects.orgId, input.orgId)];

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
				cardId: agentRuns.cardId,
				prNumber: agentRuns.prNumber,
				agentType: agentRuns.agentType,
				backend: agentRuns.backend,
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
			})
			.from(agentRuns)
			.innerJoin(projects, eq(agentRuns.projectId, projects.id))
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

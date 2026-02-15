import { desc, eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { agentRunLlmCalls, agentRunLogs, agentRuns, debugAnalyses } from '../schema/index.js';

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

export async function getDebugAnalysisByDebugRunId(debugRunId: string) {
	const db = getDb();
	const [row] = await db
		.select()
		.from(debugAnalyses)
		.where(eq(debugAnalyses.debugRunId, debugRunId));
	return row ?? null;
}

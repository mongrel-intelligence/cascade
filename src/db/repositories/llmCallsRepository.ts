import { and, eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { agentRunLlmCalls } from '../schema/index.js';

// ============================================================================
// Types
// ============================================================================

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

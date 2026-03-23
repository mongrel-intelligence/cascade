import { eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { debugAnalyses } from '../schema/index.js';

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

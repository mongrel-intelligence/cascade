import { eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { agentRunLogs } from '../schema/index.js';

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

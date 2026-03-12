import { eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { cascadeDefaults } from '../schema/index.js';

// ============================================================================
// Cascade Defaults
// ============================================================================

export async function getCascadeDefaults(orgId: string) {
	const db = getDb();
	const [row] = await db.select().from(cascadeDefaults).where(eq(cascadeDefaults.orgId, orgId));
	return row ?? null;
}

export async function upsertCascadeDefaults(
	orgId: string,
	data: {
		model?: string | null;
		maxIterations?: number | null;
		watchdogTimeoutMs?: number | null;
		workItemBudgetUsd?: string | null;
		agentEngine?: string | null;
		progressModel?: string | null;
		progressIntervalMinutes?: string | null;
	},
) {
	const db = getDb();
	const existing = await getCascadeDefaults(orgId);
	if (existing) {
		await db
			.update(cascadeDefaults)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(cascadeDefaults.orgId, orgId));
	} else {
		await db.insert(cascadeDefaults).values({ orgId, ...data });
	}
}

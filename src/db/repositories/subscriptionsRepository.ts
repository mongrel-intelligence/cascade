import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import { getDb } from '../client.js';
import { decryptCredential, encryptCredential } from '../crypto.js';
import { projectSubscriptions } from '../schema/index.js';

export type UsageWindow = 'five_hour' | 'seven_day';
export const EXHAUSTED_PCT = 95;

export interface SubscriptionMeta {
	id: number;
	projectId: string;
	name: string;
	enabled: boolean;
	fiveHourPct: number;
	fiveHourResetAt: Date | null;
	sevenDayPct: number;
	sevenDayResetAt: Date | null;
}

export interface SelectedSubscription {
	id: number;
	name: string;
	token: string;
}

const metaColumns = {
	id: projectSubscriptions.id,
	projectId: projectSubscriptions.projectId,
	name: projectSubscriptions.name,
	enabled: projectSubscriptions.enabled,
	fiveHourPct: projectSubscriptions.fiveHourPct,
	fiveHourResetAt: projectSubscriptions.fiveHourResetAt,
	sevenDayPct: projectSubscriptions.sevenDayPct,
	sevenDayResetAt: projectSubscriptions.sevenDayResetAt,
};

// A window's pct only counts while its reset time is still in the future.
const effFive = sql<number>`CASE WHEN ${projectSubscriptions.fiveHourResetAt} <= NOW() THEN 0 ELSE ${projectSubscriptions.fiveHourPct} END`;
const effSeven = sql<number>`CASE WHEN ${projectSubscriptions.sevenDayResetAt} <= NOW() THEN 0 ELSE ${projectSubscriptions.sevenDayPct} END`;

export async function selectBestSubscription(
	projectId: string,
	excludeIds: number[] = [],
): Promise<SelectedSubscription | null> {
	const conditions = [
		eq(projectSubscriptions.projectId, projectId),
		eq(projectSubscriptions.enabled, true),
		sql`${effFive} < ${EXHAUSTED_PCT}`,
		sql`${effSeven} < ${EXHAUSTED_PCT}`,
	];
	if (excludeIds.length > 0) conditions.push(notInArray(projectSubscriptions.id, excludeIds));
	const [row] = await getDb()
		.select({
			id: projectSubscriptions.id,
			name: projectSubscriptions.name,
			value: projectSubscriptions.value,
		})
		.from(projectSubscriptions)
		.where(and(...conditions))
		.orderBy(effFive, effSeven, asc(projectSubscriptions.id))
		.limit(1);
	if (!row) return null;
	return { id: row.id, name: row.name, token: decryptCredential(row.value, projectId) };
}

/**
 * Fallback when no subscription is eligible: picks the enabled row with the lowest blocking
 * pct, ignoring the threshold, so the run still reaches exit 3 and the delayed-retry path.
 */
export async function selectLeastExhaustedSubscription(
	projectId: string,
): Promise<SelectedSubscription | null> {
	const [row] = await getDb()
		.select({
			id: projectSubscriptions.id,
			name: projectSubscriptions.name,
			value: projectSubscriptions.value,
		})
		.from(projectSubscriptions)
		.where(
			and(eq(projectSubscriptions.projectId, projectId), eq(projectSubscriptions.enabled, true)),
		)
		.orderBy(sql`GREATEST(${effFive}, ${effSeven})`, asc(projectSubscriptions.id))
		.limit(1);
	if (!row) return null;
	return { id: row.id, name: row.name, token: decryptCredential(row.value, projectId) };
}

export async function hasEnabledSubscription(projectId: string): Promise<boolean> {
	const [row] = await getDb()
		.select({ id: projectSubscriptions.id })
		.from(projectSubscriptions)
		.where(
			and(eq(projectSubscriptions.projectId, projectId), eq(projectSubscriptions.enabled, true)),
		)
		.limit(1);
	return row !== undefined;
}

/** Atomic per row. Same reset time keeps the higher pct; a new reset time replaces it. */
export async function recordSubscriptionUsage(
	subscriptionId: number,
	window: UsageWindow,
	pct: number,
	resetAt: Date,
): Promise<void> {
	const p = Math.max(0, Math.min(100, Math.round(pct)));
	if (window === 'five_hour') {
		await getDb().execute(sql`
			UPDATE project_subscriptions SET
				five_hour_pct = CASE WHEN five_hour_reset_at IS DISTINCT FROM ${resetAt} THEN ${p}
					ELSE GREATEST(five_hour_pct, ${p}) END,
				five_hour_reset_at = ${resetAt}, updated_at = NOW()
			WHERE id = ${subscriptionId}`);
	} else {
		await getDb().execute(sql`
			UPDATE project_subscriptions SET
				seven_day_pct = CASE WHEN seven_day_reset_at IS DISTINCT FROM ${resetAt} THEN ${p}
					ELSE GREATEST(seven_day_pct, ${p}) END,
				seven_day_reset_at = ${resetAt}, updated_at = NOW()
			WHERE id = ${subscriptionId}`);
	}
}

/** Earliest time any enabled, currently-ineligible subscription becomes eligible again. */
export async function getEarliestEligibleAt(projectId: string): Promise<Date | null> {
	const rows = await getDb()
		.select(metaColumns)
		.from(projectSubscriptions)
		.where(
			and(eq(projectSubscriptions.projectId, projectId), eq(projectSubscriptions.enabled, true)),
		);
	const now = Date.now();
	let earliest: number | null = null;
	for (const r of rows) {
		const blocks: number[] = [];
		if (r.fiveHourPct >= EXHAUSTED_PCT && r.fiveHourResetAt && r.fiveHourResetAt.getTime() > now) {
			blocks.push(r.fiveHourResetAt.getTime());
		}
		if (r.sevenDayPct >= EXHAUSTED_PCT && r.sevenDayResetAt && r.sevenDayResetAt.getTime() > now) {
			blocks.push(r.sevenDayResetAt.getTime());
		}
		if (blocks.length === 0) continue;
		// Both blocking windows must reset before the row is eligible.
		const eligibleAt = Math.max(...blocks);
		earliest = earliest === null ? eligibleAt : Math.min(earliest, eligibleAt);
	}
	return earliest === null ? null : new Date(earliest);
}

export async function listSubscriptions(projectId: string): Promise<SubscriptionMeta[]> {
	return getDb()
		.select(metaColumns)
		.from(projectSubscriptions)
		.where(eq(projectSubscriptions.projectId, projectId))
		.orderBy(asc(projectSubscriptions.id));
}

export async function getSubscriptionProjectId(id: number): Promise<string | null> {
	const [row] = await getDb()
		.select({ projectId: projectSubscriptions.projectId })
		.from(projectSubscriptions)
		.where(eq(projectSubscriptions.id, id));
	return row?.projectId ?? null;
}

export async function createSubscription(
	projectId: string,
	name: string,
	token: string,
): Promise<number> {
	const [row] = await getDb()
		.insert(projectSubscriptions)
		.values({ projectId, name, value: encryptCredential(token, projectId) })
		.returning({ id: projectSubscriptions.id });
	return row.id;
}

export async function setSubscriptionEnabled(id: number, enabled: boolean): Promise<void> {
	await getDb()
		.update(projectSubscriptions)
		.set({ enabled })
		.where(eq(projectSubscriptions.id, id));
}

export async function deleteSubscription(id: number): Promise<void> {
	await getDb().delete(projectSubscriptions).where(eq(projectSubscriptions.id, id));
}

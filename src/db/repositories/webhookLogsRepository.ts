import { type SQL, and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { getDb } from '../client.js';
import { webhookLogs } from '../schema/index.js';

// ============================================================================
// Types
// ============================================================================

export interface InsertWebhookLogInput {
	source: string;
	method: string;
	path: string;
	headers?: Record<string, unknown>;
	body?: unknown;
	bodyRaw?: string;
	statusCode?: number;
	projectId?: string;
	eventType?: string;
	processed?: boolean;
	decisionReason?: string;
}

export interface ListWebhookLogsInput {
	source?: string;
	eventType?: string;
	receivedAfter?: Date;
	receivedBefore?: Date;
	limit: number;
	offset: number;
}

// ============================================================================
// CRUD
// ============================================================================

export async function insertWebhookLog(input: InsertWebhookLogInput): Promise<string> {
	const db = getDb();
	const [row] = await db
		.insert(webhookLogs)
		.values({
			source: input.source,
			method: input.method,
			path: input.path,
			headers: input.headers as Record<string, unknown> | undefined,
			body: input.body as Record<string, unknown> | undefined,
			bodyRaw: input.bodyRaw,
			statusCode: input.statusCode,
			projectId: input.projectId,
			eventType: input.eventType,
			processed: input.processed ?? false,
			decisionReason: input.decisionReason,
		})
		.returning({ id: webhookLogs.id });
	return row.id;
}

export async function listWebhookLogs(input: ListWebhookLogsInput) {
	const db = getDb();

	const conditions: SQL[] = [];

	if (input.source) {
		conditions.push(eq(webhookLogs.source, input.source));
	}
	if (input.eventType) {
		conditions.push(eq(webhookLogs.eventType, input.eventType));
	}
	if (input.receivedAfter) {
		conditions.push(gte(webhookLogs.receivedAt, input.receivedAfter));
	}
	if (input.receivedBefore) {
		conditions.push(lte(webhookLogs.receivedAt, input.receivedBefore));
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const [data, [{ total }]] = await Promise.all([
		db
			.select()
			.from(webhookLogs)
			.where(where)
			.orderBy(desc(webhookLogs.receivedAt))
			.limit(input.limit)
			.offset(input.offset),
		db.select({ total: count() }).from(webhookLogs).where(where),
	]);

	return { data, total };
}

export async function getWebhookLogById(id: string) {
	const db = getDb();
	// Support short ID prefixes (e.g. first 8 chars from CLI list view)
	if (id.length < 36) {
		const rows = await db
			.select()
			.from(webhookLogs)
			.where(sql`${webhookLogs.id}::text LIKE ${`${id}%`}`)
			.limit(2);
		if (rows.length === 1) return rows[0];
		if (rows.length > 1) return null; // ambiguous prefix
		return null;
	}
	const [row] = await db.select().from(webhookLogs).where(eq(webhookLogs.id, id));
	return row ?? null;
}

export async function pruneWebhookLogs(retentionCount: number): Promise<void> {
	const db = getDb();
	// Delete all rows except the most recent N
	await db.delete(webhookLogs).where(
		sql`${webhookLogs.id} NOT IN (
			SELECT id FROM ${webhookLogs}
			ORDER BY received_at DESC
			LIMIT ${retentionCount}
		)`,
	);
}

export async function getWebhookLogStats() {
	const db = getDb();
	const rows = await db
		.select({
			source: webhookLogs.source,
			count: count(),
		})
		.from(webhookLogs)
		.groupBy(webhookLogs.source);
	return rows;
}

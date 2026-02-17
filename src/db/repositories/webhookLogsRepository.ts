import { type SQL, and, asc, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
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
}

export interface ListWebhookLogsInput {
	source?: string;
	eventType?: string;
	receivedAfter?: Date;
	receivedBefore?: Date;
	limit?: number;
	offset?: number;
}

export interface WebhookLogRow {
	id: string;
	source: string;
	method: string;
	path: string;
	statusCode: number | null;
	receivedAt: Date | null;
	projectId: string | null;
	eventType: string | null;
	processed: boolean;
}

export interface WebhookLogDetailRow extends WebhookLogRow {
	headers: unknown;
	body: unknown;
	bodyRaw: string | null;
}

// ============================================================================
// Repository functions
// ============================================================================

export async function insertWebhookLog(input: InsertWebhookLogInput): Promise<string> {
	const db = getDb();
	const [row] = await db
		.insert(webhookLogs)
		.values({
			source: input.source,
			method: input.method,
			path: input.path,
			headers: input.headers ?? null,
			body: input.body ?? null,
			bodyRaw: input.bodyRaw ?? null,
			statusCode: input.statusCode ?? null,
			projectId: input.projectId ?? null,
			eventType: input.eventType ?? null,
			processed: input.processed ?? false,
		})
		.returning({ id: webhookLogs.id });
	return row.id;
}

export async function listWebhookLogs(
	input: ListWebhookLogsInput,
): Promise<{ data: WebhookLogRow[]; total: number }> {
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

	const limit = input.limit ?? 50;
	const offset = input.offset ?? 0;

	const [data, [{ total }]] = await Promise.all([
		db
			.select({
				id: webhookLogs.id,
				source: webhookLogs.source,
				method: webhookLogs.method,
				path: webhookLogs.path,
				statusCode: webhookLogs.statusCode,
				receivedAt: webhookLogs.receivedAt,
				projectId: webhookLogs.projectId,
				eventType: webhookLogs.eventType,
				processed: webhookLogs.processed,
			})
			.from(webhookLogs)
			.where(where)
			.orderBy(desc(webhookLogs.receivedAt))
			.limit(limit)
			.offset(offset),
		db.select({ total: count() }).from(webhookLogs).where(where),
	]);

	return { data, total: Number(total) };
}

export async function getWebhookLogById(id: string): Promise<WebhookLogDetailRow | null> {
	const db = getDb();
	const [row] = await db.select().from(webhookLogs).where(eq(webhookLogs.id, id)).limit(1);
	return row ?? null;
}

export async function pruneWebhookLogs(retentionCount: number): Promise<void> {
	const db = getDb();
	// Delete all rows except the most recent N rows
	await db.execute(
		sql`DELETE FROM webhook_logs WHERE id NOT IN (
			SELECT id FROM webhook_logs ORDER BY received_at DESC LIMIT ${retentionCount}
		)`,
	);
}

export async function getWebhookLogStats(): Promise<{ source: string; count: number }[]> {
	const db = getDb();
	const rows = await db
		.select({
			source: webhookLogs.source,
			count: count(),
		})
		.from(webhookLogs)
		.groupBy(webhookLogs.source)
		.orderBy(asc(webhookLogs.source));

	return rows.map((r) => ({ source: r.source, count: Number(r.count) }));
}

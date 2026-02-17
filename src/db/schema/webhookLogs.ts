import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core';

export const webhookLogs = pgTable(
	'webhook_logs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		source: text('source').notNull(),
		method: text('method').notNull(),
		path: text('path').notNull(),
		headers: jsonb('headers'),
		body: jsonb('body'),
		bodyRaw: text('body_raw'),
		statusCode: integer('status_code'),
		receivedAt: timestamp('received_at').defaultNow(),
		projectId: text('project_id'),
		eventType: text('event_type'),
		processed: boolean('processed').default(false),
	},
	(table) => [
		index('idx_webhook_logs_received_at').on(table.receivedAt),
		index('idx_webhook_logs_source').on(table.source),
		index('idx_webhook_logs_source_received_at').on(table.source, table.receivedAt),
	],
);

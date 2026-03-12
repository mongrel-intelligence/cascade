import { integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

export const cascadeDefaults = pgTable('cascade_defaults', {
	orgId: text('org_id')
		.primaryKey()
		.references(() => organizations.id, { onDelete: 'cascade' }),
	model: text('model'),
	maxIterations: integer('max_iterations'),
	watchdogTimeoutMs: integer('watchdog_timeout_ms'),
	workItemBudgetUsd: numeric('work_item_budget_usd', { precision: 10, scale: 2 }),
	agentEngine: text('agent_engine'),
	progressModel: text('progress_model'),
	progressIntervalMinutes: numeric('progress_interval_minutes', { precision: 5, scale: 1 }),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date()),
});

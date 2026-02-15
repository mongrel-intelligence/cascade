import { integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const cascadeDefaults = pgTable('cascade_defaults', {
	id: text('id').primaryKey().default('singleton'),
	model: text('model'),
	maxIterations: integer('max_iterations'),
	freshMachineTimeoutMs: integer('fresh_machine_timeout_ms'),
	watchdogTimeoutMs: integer('watchdog_timeout_ms'),
	postJobGracePeriodMs: integer('post_job_grace_period_ms'),
	cardBudgetUsd: numeric('card_budget_usd', { precision: 10, scale: 2 }),
	agentBackend: text('agent_backend'),
	progressModel: text('progress_model'),
	progressIntervalMinutes: numeric('progress_interval_minutes', { precision: 5, scale: 1 }),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date()),
});

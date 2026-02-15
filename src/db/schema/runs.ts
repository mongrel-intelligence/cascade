import {
	boolean,
	index,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core';
import { projects } from './projects.js';

export const agentRuns = pgTable(
	'agent_runs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
		cardId: text('card_id'),
		prNumber: integer('pr_number'),
		agentType: text('agent_type').notNull(),
		backend: text('backend').notNull(),
		triggerType: text('trigger_type'),
		status: text('status').notNull().default('running'),
		model: text('model'),
		maxIterations: integer('max_iterations'),
		startedAt: timestamp('started_at').defaultNow(),
		completedAt: timestamp('completed_at'),
		durationMs: integer('duration_ms'),
		llmIterations: integer('llm_iterations'),
		gadgetCalls: integer('gadget_calls'),
		costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
		success: boolean('success'),
		error: text('error'),
		prUrl: text('pr_url'),
		outputSummary: text('output_summary'),
	},
	(table) => [
		index('idx_agent_runs_project_id').on(table.projectId),
		index('idx_agent_runs_card_id').on(table.cardId),
		index('idx_agent_runs_status').on(table.status),
		index('idx_agent_runs_started_at').on(table.startedAt),
		index('idx_agent_runs_project_card').on(table.projectId, table.cardId),
	],
);

export const agentRunLogs = pgTable('agent_run_logs', {
	id: uuid('id').primaryKey().defaultRandom(),
	runId: uuid('run_id')
		.notNull()
		.unique()
		.references(() => agentRuns.id, { onDelete: 'cascade' }),
	cascadeLog: text('cascade_log'),
	llmistLog: text('llmist_log'),
});

export const agentRunLlmCalls = pgTable(
	'agent_run_llm_calls',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		runId: uuid('run_id')
			.notNull()
			.references(() => agentRuns.id, { onDelete: 'cascade' }),
		callNumber: integer('call_number').notNull(),
		request: text('request'),
		response: text('response'),
		inputTokens: integer('input_tokens'),
		outputTokens: integer('output_tokens'),
		cachedTokens: integer('cached_tokens'),
		costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
		durationMs: integer('duration_ms'),
	},
	(table) => [index('idx_agent_run_llm_calls_run_call').on(table.runId, table.callNumber)],
);

export const debugAnalyses = pgTable(
	'debug_analyses',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		analyzedRunId: uuid('analyzed_run_id')
			.notNull()
			.references(() => agentRuns.id, { onDelete: 'cascade' }),
		debugRunId: uuid('debug_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
		summary: text('summary').notNull(),
		issues: text('issues').notNull(),
		timeline: text('timeline'),
		recommendations: text('recommendations'),
		rootCause: text('root_cause'),
		severity: text('severity'),
	},
	(table) => [index('idx_debug_analyses_analyzed_run_id').on(table.analyzedRunId)],
);

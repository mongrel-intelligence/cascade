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
		workItemId: text('work_item_id'),
		prNumber: integer('pr_number'),
		agentType: text('agent_type').notNull(),
		engine: text('engine').notNull(),
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
		jobId: text('job_id'),
	},
	(table) => [
		index('idx_agent_runs_project_id').on(table.projectId),
		index('idx_agent_runs_work_item_id').on(table.workItemId),
		index('idx_agent_runs_status').on(table.status),
		index('idx_agent_runs_started_at').on(table.startedAt),
		index('idx_agent_runs_project_work_item').on(table.projectId, table.workItemId),
	],
);

export const agentRunLogs = pgTable('agent_run_logs', {
	id: uuid('id').primaryKey().defaultRandom(),
	runId: uuid('run_id')
		.notNull()
		.unique()
		.references(() => agentRuns.id, { onDelete: 'cascade' }),
	cascadeLog: text('cascade_log'),
	engineLog: text('engine_log'),
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
		model: text('model'),
		createdAt: timestamp('created_at').defaultNow(),
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

/**
 * Durable, cross-process lifecycle status of a debug analysis, keyed by the
 * analyzed run.
 *
 * The `debug_analyses` content row is written only at the END of a successful
 * analysis, and the analysis itself runs inside a separate worker container —
 * the dashboard BullMQ job reaches `completed` at container *spawn*, not at
 * analysis completion. Neither of those signals can therefore represent an
 * in-progress analysis. This table is the worker-owned signal: the worker (and
 * the dashboard at trigger time) writes `running` while the debug agent is
 * executing and `failed` if it errors; the row is deleted on success, after
 * which a present `debug_analyses` row is the `completed` signal. `updated_at`
 * lets readers treat a `running` row left behind by a crashed worker as stale
 * (older than `DEBUG_ANALYSIS_RUNNING_STALE_MS` → read as `idle`; see
 * `isDebugAnalysisRunActive` in `debugAnalysisRepository`).
 *
 * Coverage caveat: `failed` is written for catchable in-process errors — the
 * debug-runner's `catch` plus the worker's pre-runner project-config-load failure
 * in `processDashboardJob`. A hard kill (watchdog timeout / OOM) still leaves the
 * `running` row to self-stale to `idle` rather than surfacing `failed`;
 * router-side reconciliation on non-zero container exit is a deliberate
 * follow-up.
 */
export const debugAnalysisStatus = pgTable('debug_analysis_status', {
	analyzedRunId: uuid('analyzed_run_id')
		.primaryKey()
		.references(() => agentRuns.id, { onDelete: 'cascade' }),
	status: text('status').notNull(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

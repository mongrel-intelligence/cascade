import { integer, jsonb, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';
import type { EngineSettings } from '../../config/engineSettings.js';
import { projects } from './projects.js';

export const agentConfigs = pgTable(
	'agent_configs',
	{
		id: serial('id').primaryKey(),
		// Only project-scoped rows exist; org-level and global rows were removed in migration 0036.
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		agentType: text('agent_type').notNull(),
		model: text('model'),
		maxIterations: integer('max_iterations'),
		agentEngine: text('agent_engine'),
		agentEngineSettings: jsonb('agent_engine_settings').$type<EngineSettings>(),
		maxConcurrency: integer('max_concurrency'),
		systemPrompt: text('system_prompt'),
		taskPrompt: text('task_prompt'),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [unique('uq_agent_configs_project').on(t.projectId, t.agentType)],
);

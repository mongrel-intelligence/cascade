import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { projects } from './projects.js';

export const agentConfigs = pgTable(
	'agent_configs',
	{
		id: serial('id').primaryKey(),
		orgId: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
		projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
		agentType: text('agent_type').notNull(),
		model: text('model'),
		maxIterations: integer('max_iterations'),
		agentBackend: text('agent_backend'),
		prompt: text('prompt'),
		taskPrompt: text('task_prompt'),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	// Unique constraints are enforced by partial indexes in the DB:
	// - uq_agent_configs_global: UNIQUE(agent_type) WHERE project_id IS NULL
	// - uq_agent_configs_with_project: UNIQUE(project_id, agent_type) WHERE project_id IS NOT NULL
);

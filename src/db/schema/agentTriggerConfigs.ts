import { boolean, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { projects } from './projects.js';

/**
 * Per-project trigger configurations for agents.
 * Stores enabled/disabled state and parameter overrides for each trigger.
 */
export const agentTriggerConfigs = pgTable(
	'agent_trigger_configs',
	{
		id: serial('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		/** Agent type (e.g., 'implementation', 'review', 'email-joke') */
		agentType: text('agent_type').notNull(),
		/** Trigger event identifier (e.g., 'pm:status-changed', 'scm:check-suite-success') */
		triggerEvent: text('trigger_event').notNull(),
		/** Whether this trigger is enabled for this project/agent */
		enabled: boolean('enabled').notNull().default(true),
		/** Trigger-specific parameters (e.g., { targetList: 'todo', senderEmail: 'user@example.com' }) */
		parameters: jsonb('parameters').notNull().default({}),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex('uq_agent_trigger_configs_project_agent_event').on(
			table.projectId,
			table.agentType,
			table.triggerEvent,
		),
	],
);

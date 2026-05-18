import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const workflowStatusDefinitions = pgTable('workflow_status_definitions', {
	id: serial('id').primaryKey(),
	statusKey: text('status_key').notNull().unique(),
	label: text('label').notNull(),
	agentType: text('agent_type'),
	sortOrder: integer('sort_order').notNull().default(1000),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date()),
});

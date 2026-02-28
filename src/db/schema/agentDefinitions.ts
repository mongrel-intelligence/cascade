import { boolean, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const agentDefinitions = pgTable('agent_definitions', {
	id: serial('id').primaryKey(),
	agentType: text('agent_type').notNull().unique(),
	definition: jsonb('definition').notNull(),
	isBuiltin: boolean('is_builtin').default(false),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date()),
});

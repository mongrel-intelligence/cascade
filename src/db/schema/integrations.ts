import { jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { projects } from './projects.js';

export const projectIntegrations = pgTable(
	'project_integrations',
	{
		id: serial('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		category: text('category').notNull(), // 'pm' | 'scm'
		provider: text('provider').notNull(), // 'trello' | 'jira' | 'github'
		config: jsonb('config').notNull().default({}),
		triggers: jsonb('triggers').notNull().default({}),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex('uq_project_integrations_project_category').on(table.projectId, table.category),
	],
);

// integrationCredentials table has been removed.
// Integration credentials are now stored directly in project_credentials.
// See migration 0041_drop_legacy_org_credentials.sql

import {
	index,
	integer,
	jsonb,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
} from 'drizzle-orm/pg-core';
import { credentials } from './credentials.js';
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

export const integrationCredentials = pgTable(
	'integration_credentials',
	{
		id: serial('id').primaryKey(),
		integrationId: integer('integration_id')
			.notNull()
			.references(() => projectIntegrations.id, { onDelete: 'cascade' }),
		role: text('role').notNull(),
		credentialId: integer('credential_id')
			.notNull()
			.references(() => credentials.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex('uq_integration_credentials_integration_role').on(table.integrationId, table.role),
		index('idx_integration_credentials_credential_id').on(table.credentialId),
	],
);

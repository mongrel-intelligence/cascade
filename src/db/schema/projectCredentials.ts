import { pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { projects } from './projects.js';

export const projectCredentials = pgTable(
	'project_credentials',
	{
		id: serial('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		envVarKey: text('env_var_key').notNull(),
		value: text('value').notNull(),
		name: text('name'),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex('uq_project_credentials_project_env_var_key').on(table.projectId, table.envVarKey),
	],
);

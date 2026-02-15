import { pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { projects } from './projects.js';

export const projectSecrets = pgTable(
	'project_secrets',
	{
		id: serial('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		value: text('value').notNull(),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [unique('uq_project_secrets_project_key').on(table.projectId, table.key)],
);

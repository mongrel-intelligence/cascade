import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { projects } from './projects.js';

export const prWorkItems = pgTable(
	'pr_work_items',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		repoFullName: text('repo_full_name').notNull(),
		prNumber: integer('pr_number').notNull(),
		workItemId: text('work_item_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		workItemUrl: text('work_item_url'),
		workItemTitle: text('work_item_title'),
		prUrl: text('pr_url'),
		prTitle: text('pr_title'),
		updatedAt: timestamp('updated_at', { withTimezone: true }),
	},
	(table) => [
		unique('uq_pr_work_items_project_pr').on(table.projectId, table.prNumber),
		index('idx_pr_work_items_work_item').on(table.workItemId),
	],
);

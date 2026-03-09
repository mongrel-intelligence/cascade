import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { projects } from './projects.js';

export const prWorkItems = pgTable(
	'pr_work_items',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		repoFullName: text('repo_full_name'),
		prNumber: integer('pr_number'),
		workItemId: text('work_item_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		workItemUrl: text('work_item_url'),
		workItemTitle: text('work_item_title'),
		prUrl: text('pr_url'),
		prTitle: text('pr_title'),
		updatedAt: timestamp('updated_at', { withTimezone: true }),
	},
	(table) => [
		// Partial unique index: only one row per (projectId, prNumber) when prNumber is set
		unique('uq_pr_work_items_project_pr').on(table.projectId, table.prNumber),
		index('idx_pr_work_items_work_item').on(table.workItemId),
		// Index for dual-join path: look up by (projectId, workItemId)
		index('idx_pr_work_items_project_work_item').on(table.projectId, table.workItemId),
	],
);

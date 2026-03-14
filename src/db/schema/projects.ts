import { boolean, jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import type { EngineSettings } from '../../config/engineSettings.js';
import { organizations } from './organizations.js';

export const projects = pgTable(
	'projects',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		repo: text('repo').unique(),
		baseBranch: text('base_branch').default('main'),
		branchPrefix: text('branch_prefix').default('feature/'),

		model: text('model'),
		workItemBudgetUsd: numeric('work_item_budget_usd', { precision: 10, scale: 2 }),
		agentEngine: text('agent_engine'),
		agentEngineSettings: jsonb('agent_engine_settings').$type<EngineSettings>(),
		squintDbUrl: text('squint_db_url'),
		runLinksEnabled: boolean('run_links_enabled').default(false).notNull(),

		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	// Partial unique index (only for non-null values) defined in migration 0019
	() => [],
);

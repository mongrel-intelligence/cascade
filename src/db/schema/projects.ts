import { boolean, numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

export const projects = pgTable(
	'projects',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		repo: text('repo').notNull().unique(),
		baseBranch: text('base_branch').default('main'),
		branchPrefix: text('branch_prefix').default('feature/'),

		model: text('model'),
		cardBudgetUsd: numeric('card_budget_usd', { precision: 10, scale: 2 }),
		agentBackend: text('agent_backend'),
		subscriptionCostZero: boolean('subscription_cost_zero').default(false),

		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [uniqueIndex('uq_projects_repo').on(table.repo)],
);

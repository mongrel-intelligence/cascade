import {
	boolean,
	index,
	integer,
	numeric,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
} from 'drizzle-orm/pg-core';
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
		trelloBoardId: text('trello_board_id').notNull(),

		// Trello lists (individual columns replacing JSONB)
		trelloListBriefing: text('trello_list_briefing'),
		trelloListStories: text('trello_list_stories'),
		trelloListPlanning: text('trello_list_planning'),
		trelloListTodo: text('trello_list_todo'),
		trelloListInProgress: text('trello_list_in_progress'),
		trelloListInReview: text('trello_list_in_review'),
		trelloListDone: text('trello_list_done'),
		trelloListMerged: text('trello_list_merged'),
		trelloListDebug: text('trello_list_debug'),

		// Trello labels (individual columns replacing JSONB)
		trelloLabelReadyToProcess: text('trello_label_ready_to_process'),
		trelloLabelProcessing: text('trello_label_processing'),
		trelloLabelProcessed: text('trello_label_processed'),
		trelloLabelError: text('trello_label_error'),

		// Trello custom fields (individual column replacing JSONB)
		trelloCustomFieldCost: text('trello_custom_field_cost'),

		model: text('model'),
		cardBudgetUsd: numeric('card_budget_usd', { precision: 10, scale: 2 }),
		agentBackendDefault: text('agent_backend_default'),
		subscriptionCostZero: boolean('subscription_cost_zero').default(false),

		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index('idx_projects_trello_board_id').on(table.trelloBoardId),
		uniqueIndex('idx_projects_repo').on(table.repo),
	],
);

export const agentConfigs = pgTable(
	'agent_configs',
	{
		id: serial('id').primaryKey(),
		orgId: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
		projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
		agentType: text('agent_type').notNull(),
		model: text('model'),
		maxIterations: integer('max_iterations'),
		backend: text('backend'),
		prompt: text('prompt'),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	// Unique constraints are enforced by partial indexes in the DB:
	// - uq_agent_configs_global: UNIQUE(agent_type) WHERE project_id IS NULL
	// - uq_agent_configs_with_project: UNIQUE(project_id, agent_type) WHERE project_id IS NOT NULL
);

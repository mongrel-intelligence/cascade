import {
	boolean,
	integer,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
} from 'drizzle-orm/pg-core';
import { projects } from './projects.js';

// The partial index idx_project_subscriptions_project_enabled lives only in migration 0062.
export const projectSubscriptions = pgTable(
	'project_subscriptions',
	{
		id: serial('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		value: text('value').notNull(),
		enabled: boolean('enabled').notNull().default(true),
		fiveHourPct: integer('five_hour_pct').notNull().default(0),
		fiveHourResetAt: timestamp('five_hour_reset_at', { withTimezone: true }),
		sevenDayPct: integer('seven_day_pct').notNull().default(0),
		sevenDayResetAt: timestamp('seven_day_reset_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [uniqueIndex('uq_project_subscriptions_project_name').on(table.projectId, table.name)],
);

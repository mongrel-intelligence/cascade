import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

export const users = pgTable(
	'users',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		orgId: text('org_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		email: text('email').notNull().unique(),
		passwordHash: text('password_hash').notNull(),
		name: text('name').notNull(),
		role: text('role').notNull().default('member'),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [index('idx_users_org_id').on(table.orgId), index('idx_users_email').on(table.email)],
);

export const sessions = pgTable(
	'sessions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		token: text('token').notNull().unique(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').defaultNow(),
		/**
		 * Multi-org membership (spec 021): the org this session is currently
		 * acting in. Nullable; `ON DELETE SET NULL` so deleting an org never logs
		 * a user out. Ships dormant in plan 1 — plan 2's resolver falls back to
		 * the user's home org (`users.org_id`) when this is NULL.
		 */
		activeOrgId: text('active_org_id').references(() => organizations.id, {
			onDelete: 'set null',
		}),
	},
	(table) => [
		index('idx_sessions_token').on(table.token),
		index('idx_sessions_expires_at').on(table.expiresAt),
	],
);

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

/**
 * Multi-org membership (spec 021): a user account's membership in an
 * organization, with a per-org role. One account can belong to many orgs.
 *
 * This is distinct from `users.org_id` / `users.role`, which remain the user's
 * home/primary org and global role. A user has at most one membership per org
 * (enforced by the `(user_id, org_id)` unique index).
 *
 * Ships dormant in plan 1 (schema only) — nothing reads this table until plan 2
 * wires active-org resolution.
 */
export const orgMemberships = pgTable(
	'org_memberships',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		orgId: text('org_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		/** Per-org role (e.g. 'member' | 'admin'). Distinct from the global `users.role`. */
		role: text('role').notNull().default('member'),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		// One membership per (user, org).
		uniqueIndex('uq_org_memberships_user_org').on(table.userId, table.orgId),
		// Resolution lookups (plan 2) and per-org member listing.
		index('idx_org_memberships_user_id').on(table.userId),
		index('idx_org_memberships_org_id').on(table.orgId),
	],
);

import { boolean, index, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

export const credentials = pgTable(
	'credentials',
	{
		id: serial('id').primaryKey(),
		orgId: text('org_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		envVarKey: text('env_var_key').notNull(),
		value: text('value').notNull(),
		isDefault: boolean('is_default').notNull().default(false),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index('idx_credentials_org_env_var_key').on(table.orgId, table.envVarKey),
		// Partial unique: only one default per (org_id, env_var_key)
		// NOTE: Drizzle doesn't support partial unique indexes natively.
		// This is enforced by the migration SQL directly.
	],
);

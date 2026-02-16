import {
	boolean,
	index,
	integer,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { projects } from './projects.js';

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
		description: text('description'),
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

export const projectCredentialOverrides = pgTable(
	'project_credential_overrides',
	{
		id: serial('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		envVarKey: text('env_var_key').notNull(),
		credentialId: integer('credential_id')
			.notNull()
			.references(() => credentials.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').defaultNow(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex('uq_project_credential_overrides_project_env_var_key').on(
			table.projectId,
			table.envVarKey,
		),
	],
);

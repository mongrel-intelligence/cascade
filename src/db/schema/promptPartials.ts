import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

export const promptPartials = pgTable('prompt_partials', {
	id: serial('id').primaryKey(),
	orgId: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	content: text('content').notNull(),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date()),
});

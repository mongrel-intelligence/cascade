import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../client.js';
import { promptPartials } from '../schema/index.js';

export type PartialRow = typeof promptPartials.$inferSelect;

export async function loadPartials(orgId?: string): Promise<Map<string, string>> {
	const db = getDb();
	// Load global partials (org_id IS NULL)
	const globalRows = await db.select().from(promptPartials).where(isNull(promptPartials.orgId));

	const result = new Map<string, string>();
	for (const row of globalRows) {
		result.set(row.name, row.content);
	}

	// If org-scoped, overlay org partials on top of globals
	if (orgId) {
		const orgRows = await db.select().from(promptPartials).where(eq(promptPartials.orgId, orgId));
		for (const row of orgRows) {
			result.set(row.name, row.content);
		}
	}

	return result;
}

export async function listPartials(orgId?: string): Promise<PartialRow[]> {
	const db = getDb();
	if (orgId) {
		// Return both global and org-scoped
		return db
			.select()
			.from(promptPartials)
			.where(isNull(promptPartials.orgId))
			.then(async (globals) => {
				const orgRows = await db
					.select()
					.from(promptPartials)
					.where(eq(promptPartials.orgId, orgId));
				return [...globals, ...orgRows];
			});
	}
	return db.select().from(promptPartials).where(isNull(promptPartials.orgId));
}

export async function getPartial(name: string, orgId?: string): Promise<PartialRow | null> {
	const db = getDb();
	// Try org-scoped first, then global
	if (orgId) {
		const [orgRow] = await db
			.select()
			.from(promptPartials)
			.where(and(eq(promptPartials.orgId, orgId), eq(promptPartials.name, name)));
		if (orgRow) return orgRow;
	}
	const [globalRow] = await db
		.select()
		.from(promptPartials)
		.where(and(isNull(promptPartials.orgId), eq(promptPartials.name, name)));
	return globalRow ?? null;
}

export async function upsertPartial(data: {
	orgId?: string | null;
	name: string;
	content: string;
}): Promise<PartialRow> {
	const db = getDb();
	const whereCondition = data.orgId
		? and(eq(promptPartials.orgId, data.orgId), eq(promptPartials.name, data.name))
		: and(isNull(promptPartials.orgId), eq(promptPartials.name, data.name));

	const [existing] = await db.select().from(promptPartials).where(whereCondition);

	if (existing) {
		const [updated] = await db
			.update(promptPartials)
			.set({ content: data.content, updatedAt: new Date() })
			.where(eq(promptPartials.id, existing.id))
			.returning();
		return updated;
	}

	const [inserted] = await db
		.insert(promptPartials)
		.values({
			orgId: data.orgId ?? null,
			name: data.name,
			content: data.content,
		})
		.returning();
	return inserted;
}

export async function deletePartial(id: number): Promise<void> {
	const db = getDb();
	await db.delete(promptPartials).where(eq(promptPartials.id, id));
}

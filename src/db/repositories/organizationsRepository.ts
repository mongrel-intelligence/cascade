import { eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { organizations } from '../schema/index.js';

// ============================================================================
// Organizations
// ============================================================================

export async function getOrganization(orgId: string) {
	const db = getDb();
	const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId));
	return row ?? null;
}

export async function updateOrganization(orgId: string, data: { name: string }) {
	const db = getDb();
	await db.update(organizations).set({ name: data.name }).where(eq(organizations.id, orgId));
}

export async function listAllOrganizations() {
	const db = getDb();
	return db.select({ id: organizations.id, name: organizations.name }).from(organizations);
}

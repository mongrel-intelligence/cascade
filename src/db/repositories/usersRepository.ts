import { and, eq, gt, lt } from 'drizzle-orm';
import { getDb } from '../client.js';
import { sessions, users } from '../schema/index.js';

export interface DashboardUser {
	id: string;
	orgId: string;
	email: string;
	name: string;
	role: 'member' | 'admin' | 'superadmin';
}

export async function getUserByEmail(email: string) {
	const db = getDb();
	const [row] = await db.select().from(users).where(eq(users.email, email));
	return row ?? null;
}

const VALID_ROLES = new Set<DashboardUser['role']>(['member', 'admin', 'superadmin']);

export async function getUserById(id: string): Promise<DashboardUser | null> {
	const db = getDb();
	const [row] = await db
		.select({
			id: users.id,
			orgId: users.orgId,
			email: users.email,
			name: users.name,
			role: users.role,
		})
		.from(users)
		.where(eq(users.id, id));
	if (!row) return null;
	if (!VALID_ROLES.has(row.role as DashboardUser['role'])) {
		throw new Error(`Unexpected user role: ${row.role}`);
	}
	return row as DashboardUser;
}

export async function createSession(
	userId: string,
	token: string,
	expiresAt: Date,
): Promise<string> {
	const db = getDb();
	const [row] = await db
		.insert(sessions)
		.values({ userId, token, expiresAt })
		.returning({ id: sessions.id });
	return row.id;
}

export async function getSessionByToken(token: string) {
	const db = getDb();
	const now = new Date();
	const [row] = await db
		.select({
			sessionId: sessions.id,
			userId: sessions.userId,
			expiresAt: sessions.expiresAt,
		})
		.from(sessions)
		.where(and(eq(sessions.token, token), gt(sessions.expiresAt, now)));
	return row ?? null;
}

export async function deleteSession(token: string): Promise<void> {
	const db = getDb();
	await db.delete(sessions).where(eq(sessions.token, token));
}

export async function deleteExpiredSessions(): Promise<void> {
	const db = getDb();
	await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

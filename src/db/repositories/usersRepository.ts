import { and, eq, gt, lt, ne } from 'drizzle-orm';
import { getDb } from '../client.js';
import { sessions, users } from '../schema/index.js';

export interface DashboardUser {
	id: string;
	orgId: string;
	email: string;
	name: string;
	role: 'member' | 'admin' | 'superadmin';
}

export interface OrgUser {
	id: string;
	orgId: string;
	email: string;
	name: string;
	role: string;
	createdAt: Date | null;
	updatedAt: Date | null;
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

/**
 * Delete all sessions for a given user. Optionally exclude a specific token
 * (e.g. to preserve the caller's own session when they change their own password).
 */
export async function deleteUserSessions(userId: string, excludeToken?: string): Promise<void> {
	const db = getDb();
	if (excludeToken !== undefined) {
		await db
			.delete(sessions)
			.where(and(eq(sessions.userId, userId), ne(sessions.token, excludeToken)));
	} else {
		await db.delete(sessions).where(eq(sessions.userId, userId));
	}
}

// ============================================================================
// CRUD for users (org-scoped)
// ============================================================================

/**
 * List all users in an org. Never returns passwordHash.
 * Pass `opts.excludeRole` to filter out users with that role (e.g. 'superadmin').
 */
export async function listOrgUsers(
	orgId: string,
	opts?: { excludeRole?: string },
): Promise<OrgUser[]> {
	const db = getDb();
	const conditions = [eq(users.orgId, orgId)];
	if (opts?.excludeRole !== undefined) {
		conditions.push(ne(users.role, opts.excludeRole));
	}
	return db
		.select({
			id: users.id,
			orgId: users.orgId,
			email: users.email,
			name: users.name,
			role: users.role,
			createdAt: users.createdAt,
			updatedAt: users.updatedAt,
		})
		.from(users)
		.where(and(...conditions));
}

/**
 * Create a new user. The passwordHash must be pre-hashed by the caller.
 * Returns the new user's id.
 */
export async function createUser(params: {
	orgId: string;
	email: string;
	passwordHash: string;
	name: string;
	role: string;
}): Promise<{ id: string }> {
	const db = getDb();
	const [row] = await db
		.insert(users)
		.values({
			orgId: params.orgId,
			email: params.email,
			passwordHash: params.passwordHash,
			name: params.name,
			role: params.role,
		})
		.returning({ id: users.id });
	return row;
}

/**
 * Sparse update for name, email, role, passwordHash. Sets updatedAt on every update.
 */
export async function updateUser(
	id: string,
	updates: {
		name?: string;
		email?: string;
		role?: string;
		passwordHash?: string;
	},
): Promise<void> {
	const db = getDb();
	const setClause: Record<string, unknown> = { updatedAt: new Date() };
	if (updates.name !== undefined) setClause.name = updates.name;
	if (updates.email !== undefined) setClause.email = updates.email;
	if (updates.role !== undefined) setClause.role = updates.role;
	if (updates.passwordHash !== undefined) setClause.passwordHash = updates.passwordHash;

	await db.update(users).set(setClause).where(eq(users.id, id));
}

/**
 * Delete a user by id. Sessions cascade-delete via FK constraint.
 */
export async function deleteUser(id: string): Promise<void> {
	const db = getDb();
	await db.delete(users).where(eq(users.id, id));
}

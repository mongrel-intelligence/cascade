import { and, eq, gt, lt, ne } from 'drizzle-orm';
import { getDb } from '../client.js';
import { orgMemberships, sessions, users } from '../schema/index.js';

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
			// Multi-org membership (spec 021 plan 2): the org this session is
			// currently acting in. NULL falls back to the user's home org so an
			// existing session is never logged out.
			activeOrgId: sessions.activeOrgId,
		})
		.from(sessions)
		.where(and(eq(sessions.token, token), gt(sessions.expiresAt, now)));
	return row ?? null;
}

/**
 * Set (or clear) the active org on a session, identified by its token.
 * Pass `null` to fall back to the user's home org on the next request.
 *
 * Callers must validate the target org against the user's membership before
 * calling this (spec 021 plan 2 — `auth.setActiveOrg`).
 */
export async function setSessionActiveOrg(
	token: string,
	activeOrgId: string | null,
): Promise<void> {
	const db = getDb();
	await db.update(sessions).set({ activeOrgId }).where(eq(sessions.token, token));
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
 * Create a new user AND their membership in the same org, atomically
 * (spec 021 plan 3). The new account's home org is `orgId`; the membership
 * mirrors it so the account immediately appears in the org's membership-based
 * listing. The passwordHash must be pre-hashed by the caller.
 *
 * `membershipRole` is the PER-ORG role ('member' | 'admin'); callers map a
 * global 'superadmin' to an 'admin' membership (membership roles are per-org).
 *
 * Both inserts run in one transaction, so a duplicate-email unique violation
 * (`23505`) on the `users` insert rolls back without leaving an orphan
 * membership. Returns the new user's id.
 */
export async function createUserWithMembership(params: {
	orgId: string;
	email: string;
	passwordHash: string;
	name: string;
	role: string;
	membershipRole: string;
}): Promise<{ id: string }> {
	const db = getDb();
	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(users)
			.values({
				orgId: params.orgId,
				email: params.email,
				passwordHash: params.passwordHash,
				name: params.name,
				role: params.role,
			})
			.returning({ id: users.id });
		await tx.insert(orgMemberships).values({
			userId: row.id,
			orgId: params.orgId,
			role: params.membershipRole,
		});
		return row;
	});
}

/**
 * Sparse update for name, email, role, passwordHash. Sets updatedAt on every update.
 *
 * `opts.syncHomeOrgMembership` keeps the user's home-org membership role in lock
 * step with a global-role change. Home-org permissions are read from
 * `org_memberships.role` (`resolveActorRoleInOrg`), not `users.role`, so without
 * this a member↔admin edit via Settings/CLI is a silent no-op for actual
 * permissions (PR #1441 review). Only applied when `updates.role` is present;
 * membership roles are per-org ('member' | 'admin'), so a global 'superadmin'
 * maps to an 'admin' membership (mirrors `createUserWithMembership`). The user
 * row and the membership upsert run in one transaction so they cannot drift.
 */
export async function updateUser(
	id: string,
	updates: {
		name?: string;
		email?: string;
		role?: string;
		passwordHash?: string;
	},
	opts?: { syncHomeOrgMembership?: { orgId: string } },
): Promise<void> {
	const db = getDb();
	const setClause: Record<string, unknown> = { updatedAt: new Date() };
	if (updates.name !== undefined) setClause.name = updates.name;
	if (updates.email !== undefined) setClause.email = updates.email;
	if (updates.role !== undefined) setClause.role = updates.role;
	if (updates.passwordHash !== undefined) setClause.passwordHash = updates.passwordHash;

	const homeOrgId = opts?.syncHomeOrgMembership?.orgId;
	if (homeOrgId !== undefined && updates.role !== undefined) {
		const membershipRole = updates.role === 'superadmin' ? 'admin' : updates.role;
		await db.transaction(async (tx) => {
			await tx.update(users).set(setClause).where(eq(users.id, id));
			await tx
				.insert(orgMemberships)
				.values({ userId: id, orgId: homeOrgId, role: membershipRole })
				.onConflictDoUpdate({
					target: [orgMemberships.userId, orgMemberships.orgId],
					set: { role: membershipRole, updatedAt: new Date() },
				});
		});
		return;
	}

	await db.update(users).set(setClause).where(eq(users.id, id));
}

/**
 * Delete a user by id. Sessions cascade-delete via FK constraint.
 */
export async function deleteUser(id: string): Promise<void> {
	const db = getDb();
	await db.delete(users).where(eq(users.id, id));
}

import { and, eq, ne } from 'drizzle-orm';
import { getDb } from '../client.js';
import { organizations, orgMemberships, users } from '../schema/index.js';

/**
 * Read + grant helpers for the multi-org membership model (spec 021).
 *
 * Plan 1 shipped the `org_memberships` table dormant; plan 2 added the reads
 * that drive effective-org resolution, the active-org switch endpoint, and the
 * per-org actor-role helper. Plan 3 adds the management surface: granting an
 * existing account a membership (`addOrgMembership`) and listing an org's true
 * membership (`listOrgMembers`).
 */

/** A user's membership in a single org. */
export interface OrgMembership {
	orgId: string;
	/** Per-org role ('member' | 'admin'). Distinct from the global `users.role`. */
	role: string;
}

/** An org a user belongs to, with its name and the user's per-org role. */
export interface MyOrg {
	id: string;
	name: string;
	role: string;
}

/**
 * Get a user's membership in a specific org, or `null` when they are not a
 * member. Used to validate active-org switches and to resolve the per-org role.
 */
export async function getOrgMembership(
	userId: string,
	orgId: string,
): Promise<OrgMembership | null> {
	const db = getDb();
	const [row] = await db
		.select({ orgId: orgMemberships.orgId, role: orgMemberships.role })
		.from(orgMemberships)
		.where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, orgId)));
	return row ?? null;
}

/**
 * List every org a user is a member of, joined with the org name and the
 * user's per-org role. Powers the `listMyOrgs` switcher read.
 */
export async function listOrgMembershipsForUser(userId: string): Promise<MyOrg[]> {
	const db = getDb();
	return db
		.select({
			id: orgMemberships.orgId,
			name: organizations.name,
			role: orgMemberships.role,
		})
		.from(orgMemberships)
		.innerJoin(organizations, eq(orgMemberships.orgId, organizations.id))
		.where(eq(orgMemberships.userId, userId));
}

/**
 * A member of an org: the account's identity plus BOTH its PER-ORG role (from
 * the membership row) and its GLOBAL `users.role`. `orgId` is the org being
 * listed.
 *
 * Both roles are returned because the live Settings → Users editor still
 * reads/writes the global `users.role` via `users.update`: surfacing the per-org
 * `role` while editing the global one would let the editor silently revert a
 * user's global role (PR #1441 review). Consumers that manage the account use
 * `globalRole`; per-org role display/reconciliation lands with the plan-4 UI.
 */
export interface OrgMember {
	id: string;
	orgId: string;
	email: string;
	name: string;
	/** Per-org membership role ('member' | 'admin'). */
	role: string;
	/** Global account role from `users.role` ('member' | 'admin' | 'superadmin'). */
	globalRole: string;
	/** The account's HOME org (`users.org_id`), which may differ from the listed org. */
	homeOrgId: string;
	/**
	 * True when the account's home org is NOT the listed org — i.e. a "guest"
	 * granted membership via `addExistingUserToOrg`. Drives the "remove from this
	 * org" UX (remove the membership) vs. "delete account" for home-org members.
	 */
	isGuest: boolean;
	createdAt: Date | null;
	updatedAt: Date | null;
}

/**
 * List an org's true membership (spec 021 plan 3) by joining `org_memberships`
 * to `users`. Unlike the legacy `users.org_id`-scoped listing, this returns
 * every account that belongs to the org — including users whose *home* org is
 * elsewhere — and reports each one's PER-ORG role alongside its GLOBAL role.
 *
 * Pass `opts.excludeGlobalRole` to hide accounts whose GLOBAL `users.role`
 * matches (e.g. 'superadmin'), preserving the rule that a regular org admin
 * never sees global superadmins. Never returns passwordHash.
 */
export async function listOrgMembers(
	orgId: string,
	opts?: { excludeGlobalRole?: string },
): Promise<OrgMember[]> {
	const db = getDb();
	const conditions = [eq(orgMemberships.orgId, orgId)];
	if (opts?.excludeGlobalRole !== undefined) {
		conditions.push(ne(users.role, opts.excludeGlobalRole));
	}
	const rows = await db
		.select({
			id: users.id,
			orgId: orgMemberships.orgId,
			email: users.email,
			name: users.name,
			role: orgMemberships.role,
			globalRole: users.role,
			homeOrgId: users.orgId,
			createdAt: users.createdAt,
			updatedAt: users.updatedAt,
		})
		.from(orgMemberships)
		.innerJoin(users, eq(orgMemberships.userId, users.id))
		.where(and(...conditions));

	// A member whose HOME org differs from the listed org is a guest — surfaced
	// so the UI offers "remove from this org" instead of whole-account deletion.
	return rows.map((row) => ({ ...row, isGuest: row.homeOrgId !== orgId }));
}

/**
 * Remove a user's membership in a single org WITHOUT touching the account
 * (spec 021 plan 3). This is the "remove from this org" action — distinct from
 * deleting the whole account (`deleteUser`), which cascades across every org.
 * Returns `{ removed: false }` when there was no membership row to delete.
 */
export async function removeOrgMembership(
	userId: string,
	orgId: string,
): Promise<{ removed: boolean }> {
	const db = getDb();
	const deleted = await db
		.delete(orgMemberships)
		.where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, orgId)))
		.returning({ userId: orgMemberships.userId });
	return { removed: deleted.length > 0 };
}

/**
 * Grant (or re-grant) a user a membership in an org with a per-org role
 * (spec 021 plan 3). Idempotent: re-granting an existing membership updates the
 * role rather than failing on the `(user_id, org_id)` unique index, so the
 * grant mutation can be retried safely.
 */
export async function addOrgMembership(params: {
	userId: string;
	orgId: string;
	role?: string;
}): Promise<void> {
	const db = getDb();
	const role = params.role ?? 'member';
	await db
		.insert(orgMemberships)
		.values({ userId: params.userId, orgId: params.orgId, role })
		.onConflictDoUpdate({
			target: [orgMemberships.userId, orgMemberships.orgId],
			set: { role, updatedAt: new Date() },
		});
}

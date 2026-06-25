import { getOrgMembership } from '../db/repositories/orgMembershipsRepository.js';
import { getOrganization } from '../db/repositories/settingsRepository.js';
import type { TRPCUser } from './trpc.js';

/** Role used for permission evaluation. Same union as `TRPCUser['role']`. */
export type ActorRole = TRPCUser['role'];

/**
 * Resolve the org a request acts in (spec 021 plan 2).
 *
 * Two distinct paths preserve the existing superadmin contract while moving
 * regular users onto the membership model:
 *
 *  - **Superadmin** (unchanged — spec AC #7): the `x-org-context` header selects
 *    any existing org. `active_org_id` and membership do not apply to the global
 *    superadmin role.
 *  - **Everyone else**: the session's `active_org_id` governs, validated against
 *    the user's membership. It falls back to the home org (`users.org_id`) when
 *    there is no active org or the membership no longer exists — the no-logout
 *    guarantee (deleting an org / losing a membership never logs a user out).
 */
export async function computeEffectiveOrgId(
	user: TRPCUser | null,
	requestedOrgId: string | undefined,
	activeOrgId?: string | null,
): Promise<string | null> {
	if (!user) return null;

	if (user.role === 'superadmin') {
		if (requestedOrgId && requestedOrgId !== user.orgId) {
			const org = await getOrganization(requestedOrgId);
			return org ? requestedOrgId : user.orgId;
		}
		return user.orgId;
	}

	// Non-superadmin: the active org only takes effect when it differs from the
	// home org and the user still has a membership there. The home org is always
	// valid, so it needs no lookup and is the universal fallback.
	if (activeOrgId && activeOrgId !== user.orgId) {
		const membership = await getOrgMembership(user.id, activeOrgId);
		if (membership) return activeOrgId;
	}
	return user.orgId;
}

/**
 * Resolve a user's effective role *in a specific org* (spec 021 plan 2).
 *
 * Per-org membership — not the global `users.role` — governs permissions
 * (spec AC #4), so an org admin who switches to an org where they are only a
 * member cannot act as an admin there (spec AC #8).
 *
 *  - **Superadmin** is a global role (spec AC #7): always `'superadmin'`,
 *    regardless of membership.
 *  - Otherwise the per-org membership role wins.
 *  - With no membership row, acting in the **home org** falls back to the global
 *    role (no-logout guard / pre-backfill safety); any other org gets least
 *    privilege (`'member'`).
 */
export async function resolveActorRoleInOrg(params: {
	userId: string;
	globalRole: ActorRole;
	homeOrgId: string;
	orgId: string;
}): Promise<ActorRole> {
	if (params.globalRole === 'superadmin') return 'superadmin';

	const membership = await getOrgMembership(params.userId, params.orgId);
	if (membership) {
		return membership.role === 'admin' ? 'admin' : 'member';
	}

	if (params.orgId === params.homeOrgId) return params.globalRole;
	return 'member';
}

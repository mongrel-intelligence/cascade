import { TRPCError } from '@trpc/server';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import {
	addOrgMembership,
	getOrgMembership,
	listOrgMembers,
	removeOrgMembership,
} from '../../db/repositories/orgMembershipsRepository.js';
import {
	createUserWithMembership,
	deleteUser,
	deleteUserSessions,
	getUserByEmail,
	getUserById,
	updateUser,
} from '../../db/repositories/usersRepository.js';
import { resolveActorRoleInOrg } from '../context.js';
import { adminProcedure, router } from '../trpc.js';

type Role = 'member' | 'admin' | 'superadmin';
type ActorContext = { id: string; role: Role; effectiveOrgId: string };
type TargetUser = { id: string; orgId: string; role: string };

/**
 * Resolve the caller's role *in the effective org* (spec 021 plan 2).
 *
 * The `adminProcedure` middleware is a coarse global-role gate; this refines it
 * with the per-org membership role so an org admin who has switched into an org
 * where they are only a member cannot perform admin actions there (spec AC #8).
 * Superadmin stays global (spec AC #7).
 */
function resolveActorRole(ctx: {
	user: { id: string; role: Role; orgId: string };
	effectiveOrgId: string;
}): Promise<Role> {
	return resolveActorRoleInOrg({
		userId: ctx.user.id,
		globalRole: ctx.user.role,
		homeOrgId: ctx.user.orgId,
		orgId: ctx.effectiveOrgId,
	});
}

/** Require the caller to be an admin (or superadmin) in the effective org. */
function assertOrgAdmin(actorRole: Role): void {
	if (actorRole !== 'admin' && actorRole !== 'superadmin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
	}
}

/**
 * Centralizes the permission rules for editing/deleting a user. Throws TRPCError
 * with the appropriate code on any policy violation; returns silently if allowed.
 *
 * `actor.role` is the caller's PER-ORG role (resolved via `resolveActorRole`),
 * not the global `users.role` — per-org membership governs permissions
 * (spec 021 AC #4).
 *
 * Rules (apply to both `update` and `delete`):
 *   1. Cross-org access is hidden as `NOT_FOUND` (don't leak existence) unless
 *      the actor is a superadmin (who can act across orgs).
 *   2. Only superadmins can act on a superadmin target user.
 *
 * Update-specific extras (when `input.role` is set):
 *   3. No self-role-change (prevent self-demotion).
 *   4. Only superadmins can assign or change the superadmin role.
 */
function assertUserAccessAllowed(
	actor: ActorContext,
	target: TargetUser,
	options: { newRole?: Role; verb: 'edit' | 'delete' } = { verb: 'edit' },
): void {
	if (target.orgId !== actor.effectiveOrgId && actor.role !== 'superadmin') {
		throw new TRPCError({ code: 'NOT_FOUND' });
	}
	if (target.role === 'superadmin' && actor.role !== 'superadmin') {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: `Only superadmins can ${options.verb} superadmin users`,
		});
	}
	if (options.newRole !== undefined) {
		if (actor.id === target.id) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot change your own role' });
		}
		const wouldElevate = options.newRole === 'superadmin';
		const wouldDemoteSuper = target.role === 'superadmin' && options.newRole !== 'superadmin';
		if ((wouldElevate || wouldDemoteSuper) && actor.role !== 'superadmin') {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: wouldElevate
					? 'Only superadmins can assign superadmin role'
					: 'Only superadmins can change a superadmin user role',
			});
		}
	}
}

/**
 * A Postgres unique-constraint violation (e.g. the `users.email` unique index).
 *
 * drizzle wraps the driver error in a `DrizzleQueryError` whose `.cause` holds
 * the original pg `DatabaseError` carrying `code: '23505'`, so walk the cause
 * chain rather than only checking the top-level error.
 */
function isUniqueViolation(err: unknown): boolean {
	let current: unknown = err;
	for (let depth = 0; depth < 5 && current != null; depth++) {
		if (
			typeof current === 'object' &&
			'code' in current &&
			(current as { code?: unknown }).code === '23505'
		) {
			return true;
		}
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}

/**
 * Build a typed CONFLICT for a duplicate-email create (spec 021 plan 3, AC #2 —
 * no more 500 on a re-used email). The message distinguishes the two cases an
 * admin actually hits:
 *
 *  - the email is already a member of *this* org → nothing to do;
 *  - the account exists but lives elsewhere → point them at `add-to-org`.
 */
async function buildDuplicateEmailConflict(
	email: string,
	effectiveOrgId: string,
): Promise<TRPCError> {
	const existing = await getUserByEmail(email);
	if (!existing) {
		// The email collided but the row is gone (rare race) — stay generic.
		return new TRPCError({
			code: 'CONFLICT',
			message: 'A user with this email already exists.',
		});
	}
	const membership = await getOrgMembership(existing.id, effectiveOrgId);
	const alreadyMember = membership !== null || existing.orgId === effectiveOrgId;
	if (alreadyMember) {
		return new TRPCError({
			code: 'CONFLICT',
			message: 'A user with this email is already a member of this organization.',
		});
	}
	return new TRPCError({
		code: 'CONFLICT',
		message: `An account with this email already exists. Add it to this organization with \`cascade users add-to-org --email ${email}\`.`,
	});
}

export const usersRouter = router({
	list: adminProcedure.query(async ({ ctx }) => {
		const actorRole = await resolveActorRole(ctx);
		assertOrgAdmin(actorRole);
		// Membership-based listing (spec 021 plan 3, AC #5): the org's true
		// membership, including accounts whose home org is elsewhere, each with
		// their per-org role. A regular admin still never sees global superadmins.
		if (actorRole === 'superadmin') {
			return listOrgMembers(ctx.effectiveOrgId);
		}
		return listOrgMembers(ctx.effectiveOrgId, { excludeGlobalRole: 'superadmin' });
	}),

	create: adminProcedure
		.input(
			z.object({
				email: z.string().email(),
				name: z.string().min(1),
				password: z.string().min(12),
				role: z.enum(['member', 'admin', 'superadmin']).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const actorRole = await resolveActorRole(ctx);
			assertOrgAdmin(actorRole);

			const role = input.role ?? 'member';

			// Only superadmins can create users with superadmin role
			if (role === 'superadmin' && actorRole !== 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can create superadmin users',
				});
			}

			const passwordHash = await bcrypt.hash(input.password, 10);

			// Membership roles are per-org ('member' | 'admin'); a global
			// 'superadmin' maps to an 'admin' membership (mirrors the plan-1
			// backfill). The new account's home org is the effective org.
			const membershipRole = role === 'superadmin' ? 'admin' : role;

			try {
				return await createUserWithMembership({
					orgId: ctx.effectiveOrgId,
					email: input.email,
					name: input.name,
					passwordHash,
					role,
					membershipRole,
				});
			} catch (err) {
				// Graceful duplicate-email handling (spec 021 plan 3, AC #2):
				// turn the Postgres unique violation into a clear CONFLICT instead
				// of a 500. Any other error propagates unchanged.
				if (!isUniqueViolation(err)) throw err;
				throw await buildDuplicateEmailConflict(input.email, ctx.effectiveOrgId);
			}
		}),

	/**
	 * Grant an existing account a membership in the effective org with a per-org
	 * role (spec 021 plan 3, AC #1). This is the additive admin capability the
	 * bug report needed: an org admin (or superadmin) can add a registered email
	 * to *their* org without creating a duplicate account.
	 *
	 *  - The actor must be an admin/superadmin in the effective org (`adminProcedure`
	 *    is refined by the per-org role, so an org admin switched into an org where
	 *    they are only a member is denied — spec AC #8).
	 *  - NOT_FOUND when no account owns the email (callers should `create` instead).
	 *  - Idempotent: re-granting updates the per-org role rather than failing.
	 */
	addExistingUserToOrg: adminProcedure
		.input(
			z.object({
				email: z.string().email(),
				role: z.enum(['member', 'admin']).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const actorRole = await resolveActorRole(ctx);
			assertOrgAdmin(actorRole);

			const role = input.role ?? 'member';

			const existingUser = await getUserByEmail(input.email);
			if (!existingUser) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message:
						'No account exists with this email. Create the user first with `cascade users create`.',
				});
			}

			const priorMembership = await getOrgMembership(existingUser.id, ctx.effectiveOrgId);
			await addOrgMembership({
				userId: existingUser.id,
				orgId: ctx.effectiveOrgId,
				role,
			});

			return {
				userId: existingUser.id,
				email: existingUser.email,
				orgId: ctx.effectiveOrgId,
				role,
				alreadyMember: priorMembership !== null,
			};
		}),

	update: adminProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).optional(),
				email: z.string().email().optional(),
				role: z.enum(['member', 'admin', 'superadmin']).optional(),
				password: z.string().min(12).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const actorRole = await resolveActorRole(ctx);
			assertOrgAdmin(actorRole);

			const targetUser = await getUserById(input.id);
			if (!targetUser) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}

			assertUserAccessAllowed(
				{
					id: ctx.user.id,
					role: actorRole,
					effectiveOrgId: ctx.effectiveOrgId,
				},
				targetUser,
				{ newRole: input.role, verb: 'edit' },
			);

			const updates: {
				name?: string;
				email?: string;
				role?: string;
				passwordHash?: string;
			} = {};

			if (input.name !== undefined) updates.name = input.name;
			if (input.email !== undefined) updates.email = input.email;
			if (input.role !== undefined) updates.role = input.role;
			if (input.password !== undefined) {
				updates.passwordHash = await bcrypt.hash(input.password, 10);
			}

			// Sync the target's home-org membership role with a global-role change so
			// the edit actually takes effect — home-org permissions are read from
			// org_memberships.role, not users.role (PR #1441 review SHOULD_FIX).
			await updateUser(input.id, updates, {
				syncHomeOrgMembership: { orgId: targetUser.orgId },
			});

			// Invalidate all sessions for the target user when their password changes.
			// This prevents stale sessions from remaining valid after a password reset.
			if (updates.passwordHash !== undefined) {
				await deleteUserSessions(input.id);
			}
		}),

	delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const actorRole = await resolveActorRole(ctx);
		assertOrgAdmin(actorRole);

		// Prevent self-deletion
		if (ctx.user.id === input.id) {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: 'Cannot delete your own account',
			});
		}

		const targetUser = await getUserById(input.id);
		if (!targetUser) {
			throw new TRPCError({ code: 'NOT_FOUND' });
		}

		assertUserAccessAllowed(
			{ id: ctx.user.id, role: actorRole, effectiveOrgId: ctx.effectiveOrgId },
			targetUser,
			{ verb: 'delete' },
		);

		await deleteUser(input.id);
	}),

	/**
	 * Remove a user's membership in the effective org WITHOUT deleting the account
	 * (spec 021 plan 3). This is the "remove from this org" action for guests —
	 * accounts whose home org is elsewhere, surfaced in the list via `isGuest`.
	 * Distinct from `delete`, which removes the whole account and cascades its
	 * memberships across every org (PR #1441 review: that was a footgun when a
	 * guest's Delete button was used).
	 *
	 *  - Org admins (and superadmins) may remove guests from THEIR org; unlike
	 *    `delete`/`update`, this intentionally does NOT hide cross-home-org targets
	 *    as NOT_FOUND, because managing your own org's guest list is the point.
	 *  - Only superadmins can act on a superadmin account.
	 *  - Refuses to remove a user from their HOME org (that would orphan the
	 *    account — delete it instead).
	 */
	removeFromOrg: adminProcedure
		.input(z.object({ userId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const actorRole = await resolveActorRole(ctx);
			assertOrgAdmin(actorRole);

			if (ctx.user.id === input.userId) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Cannot remove yourself from the organization',
				});
			}

			const targetUser = await getUserById(input.userId);
			if (!targetUser) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}

			if (targetUser.role === 'superadmin' && actorRole !== 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can remove superadmin users',
				});
			}

			if (targetUser.orgId === ctx.effectiveOrgId) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message:
						'This is the user’s home organization. Delete the account instead of removing the membership.',
				});
			}

			const { removed } = await removeOrgMembership(input.userId, ctx.effectiveOrgId);
			if (!removed) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'This user is not a member of this organization.',
				});
			}

			return { userId: input.userId, orgId: ctx.effectiveOrgId, removed: true };
		}),
});

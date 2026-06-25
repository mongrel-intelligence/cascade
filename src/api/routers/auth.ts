import { TRPCError } from '@trpc/server';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import {
	getOrgMembership,
	listOrgMembershipsForUser,
} from '../../db/repositories/orgMembershipsRepository.js';
import { getOrganization, listAllOrganizations } from '../../db/repositories/settingsRepository.js';
import {
	deleteUserSessions,
	setSessionActiveOrg,
	updateUser,
} from '../../db/repositories/usersRepository.js';
import { protectedProcedure, router } from '../trpc.js';

export const authRouter = router({
	me: protectedProcedure.query(async ({ ctx }) => {
		const org = await getOrganization(ctx.effectiveOrgId);
		const base = {
			id: ctx.user.id,
			email: ctx.user.email,
			name: ctx.user.name,
			role: ctx.user.role,
			orgId: ctx.user.orgId,
			effectiveOrgId: ctx.effectiveOrgId,
			orgName: org?.name ?? null,
		};
		if (ctx.user.role === 'superadmin') {
			const orgs = await listAllOrganizations();
			return { ...base, availableOrgs: orgs };
		}
		return { ...base, availableOrgs: undefined as { id: string; name: string }[] | undefined };
	}),

	changePassword: protectedProcedure
		.input(
			z.object({
				password: z.string().min(12),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const passwordHash = await bcrypt.hash(input.password, 10);
			await updateUser(ctx.user.id, { passwordHash });
			await deleteUserSessions(ctx.user.id, ctx.token || undefined);
		}),

	/**
	 * List the orgs the current user belongs to (spec 021 plan 2), with the
	 * user's per-org role. Drives the active-org switcher (UI lands in plan 4).
	 * Superadmins still discover all orgs via `me.availableOrgs`.
	 */
	listMyOrgs: protectedProcedure.query(async ({ ctx }) => {
		return listOrgMembershipsForUser(ctx.user.id);
	}),

	/**
	 * Switch the current session's active org (spec 021 plan 2). Validated
	 * against membership (spec AC #8 — a user can only act in orgs they belong
	 * to); superadmin cross-org access continues via the `x-org-context` header
	 * (spec AC #7) and is unaffected by this column.
	 */
	setActiveOrg: protectedProcedure
		.input(z.object({ orgId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const membership = await getOrgMembership(ctx.user.id, input.orgId);
			if (!membership) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'You are not a member of this organization',
				});
			}
			if (!ctx.token) {
				throw new TRPCError({ code: 'UNAUTHORIZED' });
			}
			await setSessionActiveOrg(ctx.token, input.orgId);
			return { activeOrgId: input.orgId, role: membership.role };
		}),
});

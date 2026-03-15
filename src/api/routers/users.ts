import { TRPCError } from '@trpc/server';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import {
	createUser,
	deleteUser,
	getUserById,
	listOrgUsers,
	updateUser,
} from '../../db/repositories/usersRepository.js';
import { adminProcedure, router } from '../trpc.js';

export const usersRouter = router({
	list: adminProcedure.query(async ({ ctx }) => {
		if (ctx.user.role === 'superadmin') {
			return listOrgUsers(ctx.effectiveOrgId);
		}
		return listOrgUsers(ctx.effectiveOrgId, { excludeRole: 'superadmin' });
	}),

	create: adminProcedure
		.input(
			z.object({
				email: z.string().email(),
				name: z.string().min(1),
				password: z.string().min(1),
				role: z.enum(['member', 'admin', 'superadmin']).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const role = input.role ?? 'member';

			// Only superadmins can create users with superadmin role
			if (role === 'superadmin' && ctx.user.role !== 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can create superadmin users',
				});
			}

			const passwordHash = await bcrypt.hash(input.password, 10);

			return createUser({
				orgId: ctx.effectiveOrgId,
				email: input.email,
				name: input.name,
				passwordHash,
				role,
			});
		}),

	update: adminProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).optional(),
				email: z.string().email().optional(),
				role: z.enum(['member', 'admin', 'superadmin']).optional(),
				password: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Verify target user belongs to same org
			const targetUser = await getUserById(input.id);

			if (!targetUser) {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}

			if (targetUser.orgId !== ctx.effectiveOrgId && ctx.user.role !== 'superadmin') {
				throw new TRPCError({ code: 'NOT_FOUND' });
			}

			// Non-superadmins cannot edit any field on a superadmin user
			if (targetUser.role === 'superadmin' && ctx.user.role !== 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can edit superadmin users',
				});
			}

			// Prevent self-demotion (can't change own role)
			if (input.role !== undefined && ctx.user.id === input.id) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Cannot change your own role',
				});
			}

			// Only superadmins can set role to superadmin
			if (input.role === 'superadmin' && ctx.user.role !== 'superadmin') {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can assign superadmin role',
				});
			}

			// Only superadmins can change a superadmin's role
			if (
				targetUser.role === 'superadmin' &&
				input.role !== 'superadmin' &&
				ctx.user.role !== 'superadmin'
			) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Only superadmins can change a superadmin user role',
				});
			}

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

			await updateUser(input.id, updates);
		}),

	delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		// Prevent self-deletion
		if (ctx.user.id === input.id) {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: 'Cannot delete your own account',
			});
		}

		// Verify org ownership
		const targetUser = await getUserById(input.id);

		if (!targetUser) {
			throw new TRPCError({ code: 'NOT_FOUND' });
		}

		if (targetUser.orgId !== ctx.effectiveOrgId && ctx.user.role !== 'superadmin') {
			throw new TRPCError({ code: 'NOT_FOUND' });
		}

		// Only superadmins can delete superadmin users
		if (targetUser.role === 'superadmin' && ctx.user.role !== 'superadmin') {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: 'Only superadmins can delete superadmin users',
			});
		}

		await deleteUser(input.id);
	}),
});

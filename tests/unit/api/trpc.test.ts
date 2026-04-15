import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import {
	adminProcedure,
	protectedProcedure,
	router,
	superAdminProcedure,
	type TRPCContext,
} from '../../../src/api/trpc.js';

// Create a minimal test router
const testRouter = router({
	whoami: protectedProcedure.query(({ ctx }) => ctx.user),
	adminOnly: adminProcedure.query(({ ctx }) => ctx.user),
	superAdminOnly: superAdminProcedure.query(({ ctx }) => ctx.user),
});

function createCaller(ctx: TRPCContext) {
	return testRouter.createCaller(ctx);
}

describe('tRPC protectedProcedure', () => {
	it('throws UNAUTHORIZED when ctx.user is null', async () => {
		const caller = createCaller({ user: null, effectiveOrgId: null });

		await expect(caller.whoami()).rejects.toThrow(TRPCError);
		await expect(caller.whoami()).rejects.toMatchObject({
			code: 'UNAUTHORIZED',
		});
	});

	it('passes through when ctx.user is present', async () => {
		const mockUser = {
			id: 'user-1',
			orgId: 'org-1',
			email: 'test@example.com',
			name: 'Test',
			role: 'admin',
		};
		const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

		const result = await caller.whoami();
		expect(result).toEqual(mockUser);
	});
});

describe('tRPC adminProcedure', () => {
	it('throws UNAUTHORIZED when ctx.user is null', async () => {
		const caller = createCaller({ user: null, effectiveOrgId: null });

		await expect(caller.adminOnly()).rejects.toThrow(TRPCError);
		await expect(caller.adminOnly()).rejects.toMatchObject({
			code: 'UNAUTHORIZED',
		});
	});

	it('throws FORBIDDEN when user is not admin', async () => {
		const memberUser = {
			id: 'user-2',
			orgId: 'org-1',
			email: 'member@example.com',
			name: 'Member',
			role: 'member',
		};
		const caller = createCaller({ user: memberUser, effectiveOrgId: memberUser.orgId });

		await expect(caller.adminOnly()).rejects.toThrow(TRPCError);
		await expect(caller.adminOnly()).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
	});

	it('passes through when user is admin', async () => {
		const adminUser = {
			id: 'user-1',
			orgId: 'org-1',
			email: 'admin@example.com',
			name: 'Admin',
			role: 'admin',
		};
		const caller = createCaller({ user: adminUser, effectiveOrgId: adminUser.orgId });

		const result = await caller.adminOnly();
		expect(result).toEqual(adminUser);
	});

	it('passes through when user is superadmin (inherits admin access)', async () => {
		const superAdminUser = {
			id: 'user-sa',
			orgId: 'org-1',
			email: 'admin@cascade.dev',
			name: 'Super Admin',
			role: 'superadmin',
		};
		const caller = createCaller({ user: superAdminUser, effectiveOrgId: superAdminUser.orgId });

		const result = await caller.adminOnly();
		expect(result).toEqual(superAdminUser);
	});
});

describe('tRPC superAdminProcedure', () => {
	it('throws UNAUTHORIZED when ctx.user is null', async () => {
		const caller = createCaller({ user: null, effectiveOrgId: null });

		await expect(caller.superAdminOnly()).rejects.toThrow(TRPCError);
		await expect(caller.superAdminOnly()).rejects.toMatchObject({
			code: 'UNAUTHORIZED',
		});
	});

	it('throws FORBIDDEN when user is a regular member', async () => {
		const memberUser = {
			id: 'user-2',
			orgId: 'org-1',
			email: 'member@example.com',
			name: 'Member',
			role: 'member',
		};
		const caller = createCaller({ user: memberUser, effectiveOrgId: memberUser.orgId });

		await expect(caller.superAdminOnly()).rejects.toThrow(TRPCError);
		await expect(caller.superAdminOnly()).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Superadmin access required',
		});
	});

	it('throws FORBIDDEN when user is admin (not superadmin)', async () => {
		const adminUser = {
			id: 'user-1',
			orgId: 'org-1',
			email: 'admin@example.com',
			name: 'Admin',
			role: 'admin',
		};
		const caller = createCaller({ user: adminUser, effectiveOrgId: adminUser.orgId });

		await expect(caller.superAdminOnly()).rejects.toThrow(TRPCError);
		await expect(caller.superAdminOnly()).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Superadmin access required',
		});
	});

	it('passes through when user is superadmin', async () => {
		const superAdminUser = {
			id: 'user-sa',
			orgId: 'org-1',
			email: 'admin@cascade.dev',
			name: 'Super Admin',
			role: 'superadmin',
		};
		const caller = createCaller({ user: superAdminUser, effectiveOrgId: superAdminUser.orgId });

		const result = await caller.superAdminOnly();
		expect(result).toEqual(superAdminUser);
	});
});

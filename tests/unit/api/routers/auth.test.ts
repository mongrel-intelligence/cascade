import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';

const mockListAllOrganizations = vi.fn();
const mockGetOrganization = vi.fn();

vi.mock('../../../../src/db/repositories/settingsRepository.js', () => ({
	listAllOrganizations: (...args: unknown[]) => mockListAllOrganizations(...args),
	getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
}));

import { authRouter } from '../../../../src/api/routers/auth.js';

function createCaller(ctx: TRPCContext) {
	return authRouter.createCaller(ctx);
}

describe('authRouter', () => {
	describe('me', () => {
		it('returns user data from context for admin (no availableOrgs)', async () => {
			const mockUser = createMockUser();
			mockGetOrganization.mockResolvedValue({ id: 'org-1', name: 'Org One' });
			const caller = createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

			const result = await caller.me();

			expect(result).toEqual({
				id: 'user-1',
				email: 'test@example.com',
				name: 'Test User',
				role: 'admin',
				orgId: 'org-1',
				effectiveOrgId: 'org-1',
				orgName: 'Org One',
				availableOrgs: undefined,
			});
			expect(mockListAllOrganizations).not.toHaveBeenCalled();
			expect(mockGetOrganization).toHaveBeenCalledWith('org-1');
		});

		it('returns availableOrgs for superadmin', async () => {
			const superAdmin = createMockSuperAdmin();
			mockGetOrganization.mockResolvedValue({ id: 'org-1', name: 'Org One' });
			mockListAllOrganizations.mockResolvedValue([{ id: 'org-1', name: 'Org One' }]);
			const caller = createCaller({ user: superAdmin, effectiveOrgId: superAdmin.orgId });

			const result = await caller.me();

			expect(result).toEqual({
				id: 'superadmin-1',
				email: 'admin@cascade.dev',
				name: 'Super Admin',
				role: 'superadmin',
				orgId: 'org-1',
				effectiveOrgId: 'org-1',
				orgName: 'Org One',
				availableOrgs: [{ id: 'org-1', name: 'Org One' }],
			});
			expect(mockListAllOrganizations).toHaveBeenCalledOnce();
			expect(mockGetOrganization).toHaveBeenCalledWith('org-1');
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });

			await expect(caller.me()).rejects.toThrow(TRPCError);
			await expect(caller.me()).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});
	});
});

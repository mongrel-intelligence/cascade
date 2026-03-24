import { describe, expect, it, vi } from 'vitest';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

const { mockListAllOrganizations, mockGetOrganization } = vi.hoisted(() => ({
	mockListAllOrganizations: vi.fn(),
	mockGetOrganization: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/settingsRepository.js', () => ({
	listAllOrganizations: mockListAllOrganizations,
	getOrganization: mockGetOrganization,
}));

import { authRouter } from '../../../../src/api/routers/auth.js';

const createCaller = createCallerFor(authRouter);

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
			await expectTRPCError(caller.me(), 'UNAUTHORIZED');
		});
	});
});

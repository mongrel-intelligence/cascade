import { describe, expect, it, vi } from 'vitest';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

const {
	mockListAllOrganizations,
	mockGetOrganization,
	mockUpdateUser,
	mockDeleteUserSessions,
	mockSetSessionActiveOrg,
	mockGetOrgMembership,
	mockListOrgMembershipsForUser,
} = vi.hoisted(() => ({
	mockListAllOrganizations: vi.fn(),
	mockGetOrganization: vi.fn(),
	mockUpdateUser: vi.fn(),
	mockDeleteUserSessions: vi.fn(),
	mockSetSessionActiveOrg: vi.fn(),
	mockGetOrgMembership: vi.fn(),
	mockListOrgMembershipsForUser: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/settingsRepository.js', () => ({
	listAllOrganizations: mockListAllOrganizations,
	getOrganization: mockGetOrganization,
}));

vi.mock('../../../../src/db/repositories/usersRepository.js', () => ({
	updateUser: mockUpdateUser,
	deleteUserSessions: mockDeleteUserSessions,
	setSessionActiveOrg: mockSetSessionActiveOrg,
}));

vi.mock('../../../../src/db/repositories/orgMembershipsRepository.js', () => ({
	getOrgMembership: mockGetOrgMembership,
	listOrgMembershipsForUser: mockListOrgMembershipsForUser,
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
			const caller = createCaller({ user: null, effectiveOrgId: null, token: null });
			await expectTRPCError(caller.me(), 'UNAUTHORIZED');
		});
	});

	describe('changePassword', () => {
		it('hashes password, updates user, and deletes other sessions', async () => {
			const mockUser = createMockUser();
			const caller = createCaller({
				user: mockUser,
				effectiveOrgId: mockUser.orgId,
				token: 'current-session-token',
			});

			await caller.changePassword({ password: 'new-secure-password-123' });

			expect(mockUpdateUser).toHaveBeenCalledWith(mockUser.id, {
				passwordHash: expect.any(String),
			});
			expect(mockDeleteUserSessions).toHaveBeenCalledWith(mockUser.id, 'current-session-token');
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null, token: null });
			await expectTRPCError(
				caller.changePassword({ password: 'new-secure-password-123' }),
				'UNAUTHORIZED',
			);
		});
	});

	// =====================================================================
	// Multi-org membership switcher primitives (spec 021 plan 2)
	// =====================================================================
	describe('listMyOrgs', () => {
		it("returns the current user's memberships with per-org roles", async () => {
			const memberships = [
				{ id: 'org-1', name: 'Org One', role: 'admin' },
				{ id: 'org-2', name: 'Org Two', role: 'member' },
			];
			mockListOrgMembershipsForUser.mockResolvedValue(memberships);
			const mockUser = createMockUser();
			const caller = createCaller({
				user: mockUser,
				effectiveOrgId: mockUser.orgId,
				token: 'tok',
			});

			const result = await caller.listMyOrgs();

			expect(mockListOrgMembershipsForUser).toHaveBeenCalledWith(mockUser.id);
			expect(result).toEqual(memberships);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null, token: null });
			await expectTRPCError(caller.listMyOrgs(), 'UNAUTHORIZED');
		});
	});

	describe('setActiveOrg', () => {
		it('switches the session active org when the user is a member of the target', async () => {
			mockGetOrgMembership.mockResolvedValue({ orgId: 'org-2', role: 'member' });
			const mockUser = createMockUser();
			const caller = createCaller({
				user: mockUser,
				effectiveOrgId: mockUser.orgId,
				token: 'session-token',
			});

			const result = await caller.setActiveOrg({ orgId: 'org-2' });

			expect(mockGetOrgMembership).toHaveBeenCalledWith(mockUser.id, 'org-2');
			expect(mockSetSessionActiveOrg).toHaveBeenCalledWith('session-token', 'org-2');
			expect(result).toEqual({ activeOrgId: 'org-2', role: 'member' });
		});

		it('rejects switching to an org the user is not a member of (FORBIDDEN)', async () => {
			mockGetOrgMembership.mockResolvedValue(null);
			const mockUser = createMockUser();
			const caller = createCaller({
				user: mockUser,
				effectiveOrgId: mockUser.orgId,
				token: 'session-token',
			});

			await expectTRPCError(caller.setActiveOrg({ orgId: 'org-2' }), 'FORBIDDEN');
			expect(mockSetSessionActiveOrg).not.toHaveBeenCalled();
		});

		it('throws UNAUTHORIZED when the session has no token', async () => {
			mockGetOrgMembership.mockResolvedValue({ orgId: 'org-2', role: 'member' });
			const mockUser = createMockUser();
			const caller = createCaller({
				user: mockUser,
				effectiveOrgId: mockUser.orgId,
				token: null,
			});

			await expectTRPCError(caller.setActiveOrg({ orgId: 'org-2' }), 'UNAUTHORIZED');
			expect(mockSetSessionActiveOrg).not.toHaveBeenCalled();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null, token: null });
			await expectTRPCError(caller.setActiveOrg({ orgId: 'org-2' }), 'UNAUTHORIZED');
		});
	});
});

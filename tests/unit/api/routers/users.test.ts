import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';
import { createCallerFor } from '../../../helpers/trpcTestHarness.js';

const {
	mockListOrgMembers,
	mockCreateUserWithMembership,
	mockUpdateUser,
	mockDeleteUser,
	mockGetUserById,
	mockGetUserByEmail,
	mockDeleteUserSessions,
	mockBcryptHash,
	mockGetOrgMembership,
	mockAddOrgMembership,
	mockRemoveOrgMembership,
} = vi.hoisted(() => ({
	mockListOrgMembers: vi.fn(),
	mockCreateUserWithMembership: vi.fn(),
	mockUpdateUser: vi.fn(),
	mockDeleteUser: vi.fn(),
	mockGetUserById: vi.fn(),
	mockGetUserByEmail: vi.fn(),
	mockDeleteUserSessions: vi.fn(),
	mockBcryptHash: vi.fn(),
	mockGetOrgMembership: vi.fn(),
	mockAddOrgMembership: vi.fn(),
	mockRemoveOrgMembership: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/usersRepository.js', () => ({
	createUserWithMembership: mockCreateUserWithMembership,
	updateUser: mockUpdateUser,
	deleteUser: mockDeleteUser,
	getUserById: mockGetUserById,
	getUserByEmail: mockGetUserByEmail,
	deleteUserSessions: mockDeleteUserSessions,
}));

// Per-org actor-role helper (spec 021 plan 2) reads memberships through this
// repository. Default: no membership row → resolveActorRoleInOrg falls back to
// the global role for the home org, so the existing admin/member/superadmin
// tests (which act in their home org) are unaffected. Plan 3 adds the
// membership-based listing + grant mutation, also mocked here.
vi.mock('../../../../src/db/repositories/orgMembershipsRepository.js', () => ({
	getOrgMembership: mockGetOrgMembership,
	listOrgMembers: mockListOrgMembers,
	addOrgMembership: mockAddOrgMembership,
	removeOrgMembership: mockRemoveOrgMembership,
}));

vi.mock('bcrypt', () => ({
	default: {
		hash: mockBcryptHash,
	},
}));

import { usersRouter } from '../../../../src/api/routers/users.js';

const createCaller = createCallerFor(usersRouter);

const mockAdminUser = createMockUser({ role: 'admin' });
const mockSuperAdmin = createMockSuperAdmin();
const mockMember = createMockUser({ id: 'member-1', role: 'member' });

describe('usersRouter', () => {
	beforeEach(() => {
		mockBcryptHash.mockResolvedValue('hashed-password');
		mockDeleteUserSessions.mockResolvedValue(undefined);
		mockAddOrgMembership.mockResolvedValue(undefined);
		mockRemoveOrgMembership.mockResolvedValue({ removed: true });
		// Default: caller has no explicit membership row, so the per-org role
		// resolver falls back to the global role for their home org.
		mockGetOrgMembership.mockResolvedValue(null);
	});

	describe('list', () => {
		it('returns the org membership list without passwordHash (admin caller excludes global superadmins)', async () => {
			const orgMembers = [
				{
					id: 'user-1',
					orgId: 'org-1',
					email: 'alice@example.com',
					name: 'Alice',
					role: 'admin',
					globalRole: 'admin',
					createdAt: null,
					updatedAt: null,
				},
				{
					id: 'user-2',
					orgId: 'org-1',
					email: 'bob@example.com',
					name: 'Bob',
					role: 'member',
					globalRole: 'member',
					createdAt: null,
					updatedAt: null,
				},
			];
			mockListOrgMembers.mockResolvedValue(orgMembers);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			const result = await caller.list();

			expect(mockListOrgMembers).toHaveBeenCalledWith('org-1', { excludeGlobalRole: 'superadmin' });
			expect(result).toEqual(orgMembers);
			// Note: passwordHash exclusion is enforced at the repository layer (listOrgMembers selects
			// specific columns). The mock already returns data without passwordHash, reflecting
			// the contract that the repository never returns this field.
		});

		it('superadmin caller receives the full membership list including global superadmins', async () => {
			const orgMembers = [
				{
					id: 'user-1',
					orgId: 'org-1',
					email: 'alice@example.com',
					name: 'Alice',
					role: 'admin',
					globalRole: 'admin',
					createdAt: null,
					updatedAt: null,
				},
				{
					id: 'superadmin-2',
					orgId: 'org-1',
					email: 'super@example.com',
					name: 'Super',
					role: 'admin',
					globalRole: 'superadmin',
					createdAt: null,
					updatedAt: null,
				},
			];
			mockListOrgMembers.mockResolvedValue(orgMembers);
			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });

			const result = await caller.list();

			expect(mockListOrgMembers).toHaveBeenCalledWith('org-1');
			expect(result).toEqual(orgMembers);
		});

		it('returns empty array when no members', async () => {
			mockListOrgMembers.mockResolvedValue([]);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			const result = await caller.list();
			expect(result).toEqual([]);
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});

		it('throws FORBIDDEN when user is a member', async () => {
			const caller = createCaller({ user: mockMember, effectiveOrgId: mockMember.orgId });
			await expect(caller.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});
	});

	describe('create', () => {
		it('creates user with hashed password and a mirrored membership', async () => {
			mockCreateUserWithMembership.mockResolvedValue({ id: 'new-user-1' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			const result = await caller.create({
				email: 'newuser@example.com',
				name: 'New User',
				password: 'secret123456789',
			});

			expect(mockBcryptHash).toHaveBeenCalledWith('secret123456789', 10);
			expect(mockCreateUserWithMembership).toHaveBeenCalledWith({
				orgId: 'org-1',
				email: 'newuser@example.com',
				name: 'New User',
				passwordHash: 'hashed-password',
				role: 'member',
				membershipRole: 'member',
			});
			expect(result).toEqual({ id: 'new-user-1' });
		});

		it('creates admin user with an admin membership when role is specified', async () => {
			mockCreateUserWithMembership.mockResolvedValue({ id: 'new-admin-1' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.create({
				email: 'newadmin@example.com',
				name: 'New Admin',
				password: 'secret123456789',
				role: 'admin',
			});

			expect(mockCreateUserWithMembership).toHaveBeenCalledWith(
				expect.objectContaining({ role: 'admin', membershipRole: 'admin' }),
			);
		});

		it('rejects superadmin role assignment when caller is not superadmin (FORBIDDEN)', async () => {
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(
				caller.create({
					email: 'superuser@example.com',
					name: 'Super User',
					password: 'secret123456789',
					role: 'superadmin',
				}),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });

			expect(mockCreateUserWithMembership).not.toHaveBeenCalled();
		});

		it('allows superadmin to create superadmin users, mapping membership to admin', async () => {
			mockCreateUserWithMembership.mockResolvedValue({ id: 'new-super-1' });
			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });

			await caller.create({
				email: 'super2@example.com',
				name: 'Super 2',
				password: 'secret123456789',
				role: 'superadmin',
			});

			expect(mockCreateUserWithMembership).toHaveBeenCalledWith(
				expect.objectContaining({ role: 'superadmin', membershipRole: 'admin' }),
			);
		});

		it('rejects password shorter than 12 characters', async () => {
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(
				caller.create({ email: 'x@example.com', name: 'X', password: 'short' }),
			).rejects.toThrow();

			expect(mockCreateUserWithMembership).not.toHaveBeenCalled();
		});

		it('accepts password of exactly 12 characters', async () => {
			mockCreateUserWithMembership.mockResolvedValue({ id: 'new-user-1' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.create({ email: 'x@example.com', name: 'X', password: 'exactly12chr' });

			expect(mockCreateUserWithMembership).toHaveBeenCalled();
		});

		it('accepts password longer than 12 characters', async () => {
			mockCreateUserWithMembership.mockResolvedValue({ id: 'new-user-2' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.create({
				email: 'x@example.com',
				name: 'X',
				password: 'this-is-a-very-long-password-123',
			});

			expect(mockCreateUserWithMembership).toHaveBeenCalled();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(
				caller.create({ email: 'x@x.com', name: 'X', password: 'x' }),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		});

		it('throws FORBIDDEN when user is a member', async () => {
			const caller = createCaller({ user: mockMember, effectiveOrgId: mockMember.orgId });
			await expect(
				caller.create({ email: 'x@x.com', name: 'X', password: 'x' }),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
		});

		// =================================================================
		// Graceful duplicate-email create (spec 021 plan 3, AC #2 — no 500)
		// =================================================================
		it('maps a duplicate-email unique violation to CONFLICT — already a member here', async () => {
			mockCreateUserWithMembership.mockRejectedValue(
				Object.assign(new Error('duplicate key value'), { code: '23505' }),
			);
			// The existing account's home org IS this org → already a member here.
			// Leave getOrgMembership at its default (null) so the admin actor still
			// resolves to admin in their home org.
			mockGetUserByEmail.mockResolvedValue({ id: 'existing-1', orgId: 'org-1', role: 'member' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(
				caller.create({
					email: 'dupe@example.com',
					name: 'Dupe',
					password: 'secret123456789',
				}),
			).rejects.toMatchObject({
				code: 'CONFLICT',
				message: expect.stringContaining('already a member'),
			});
		});

		it('maps a duplicate-email for an out-of-org account to CONFLICT — add-to-org guidance', async () => {
			// Realistic drizzle shape: DrizzleQueryError wrapping the pg error on
			// `.cause`. isUniqueViolation must walk the cause chain.
			mockCreateUserWithMembership.mockRejectedValue(
				Object.assign(new Error('Failed query'), {
					cause: Object.assign(new Error('duplicate key value'), { code: '23505' }),
				}),
			);
			// Account exists but its home org is elsewhere and it has no membership here.
			mockGetUserByEmail.mockResolvedValue({
				id: 'existing-2',
				orgId: 'other-org',
				role: 'member',
			});
			mockGetOrgMembership.mockResolvedValue(null);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(
				caller.create({
					email: 'elsewhere@example.com',
					name: 'Elsewhere',
					password: 'secret123456789',
				}),
			).rejects.toMatchObject({
				code: 'CONFLICT',
				message: expect.stringContaining('add-to-org'),
			});
		});

		it('rethrows non-unique-violation errors unchanged', async () => {
			mockCreateUserWithMembership.mockRejectedValue(new Error('connection reset'));
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(
				caller.create({ email: 'x@example.com', name: 'X', password: 'secret123456789' }),
			).rejects.toThrow('connection reset');
		});
	});

	// =====================================================================
	// addExistingUserToOrg grant mutation (spec 021 plan 3, AC #1)
	// =====================================================================
	describe('addExistingUserToOrg', () => {
		it('grants an existing account a membership in the effective org', async () => {
			mockGetUserByEmail.mockResolvedValue({
				id: 'existing-1',
				orgId: 'other-org',
				email: 'alice@example.com',
				role: 'member',
			});
			mockGetOrgMembership.mockResolvedValue(null);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			const result = await caller.addExistingUserToOrg({
				email: 'alice@example.com',
				role: 'admin',
			});

			expect(mockAddOrgMembership).toHaveBeenCalledWith({
				userId: 'existing-1',
				orgId: 'org-1',
				role: 'admin',
			});
			expect(result).toEqual({
				userId: 'existing-1',
				email: 'alice@example.com',
				orgId: 'org-1',
				role: 'admin',
				alreadyMember: false,
			});
		});

		it('defaults the granted role to member', async () => {
			mockGetUserByEmail.mockResolvedValue({
				id: 'existing-1',
				orgId: 'other-org',
				email: 'alice@example.com',
				role: 'member',
			});
			mockGetOrgMembership.mockResolvedValue(null);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			const result = await caller.addExistingUserToOrg({ email: 'alice@example.com' });

			expect(mockAddOrgMembership).toHaveBeenCalledWith(
				expect.objectContaining({ role: 'member' }),
			);
			expect(result.role).toBe('member');
		});

		it('is idempotent: re-granting an existing membership reports alreadyMember', async () => {
			mockGetUserByEmail.mockResolvedValue({
				id: 'existing-1',
				orgId: 'org-1',
				email: 'alice@example.com',
				role: 'member',
			});
			// Per-org resolver consults membership for the actor; default null is
			// fine (admin acting in home org). The grant target's prior membership
			// is the second lookup — return an existing row.
			mockGetOrgMembership.mockResolvedValueOnce(null).mockResolvedValueOnce({
				orgId: 'org-1',
				role: 'member',
			});
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			const result = await caller.addExistingUserToOrg({
				email: 'alice@example.com',
				role: 'admin',
			});

			expect(result.alreadyMember).toBe(true);
			expect(mockAddOrgMembership).toHaveBeenCalledWith({
				userId: 'existing-1',
				orgId: 'org-1',
				role: 'admin',
			});
		});

		it('throws NOT_FOUND when no account owns the email', async () => {
			mockGetUserByEmail.mockResolvedValue(null);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(
				caller.addExistingUserToOrg({ email: 'ghost@example.com' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
			expect(mockAddOrgMembership).not.toHaveBeenCalled();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.addExistingUserToOrg({ email: 'a@example.com' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('throws FORBIDDEN when caller is a member', async () => {
			const caller = createCaller({ user: mockMember, effectiveOrgId: mockMember.orgId });
			await expect(caller.addExistingUserToOrg({ email: 'a@example.com' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
			expect(mockAddOrgMembership).not.toHaveBeenCalled();
		});

		it('denies an org admin switched to an org where they are only a member (AC #8)', async () => {
			mockGetOrgMembership.mockResolvedValue({ orgId: 'org-2', role: 'member' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: 'org-2' });

			await expect(
				caller.addExistingUserToOrg({ email: 'a@example.com', role: 'admin' }),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
			expect(mockGetUserByEmail).not.toHaveBeenCalled();
			expect(mockAddOrgMembership).not.toHaveBeenCalled();
		});
	});

	describe('update', () => {
		it('allows sparse update for name', async () => {
			mockGetUserById.mockResolvedValue({
				id: 'user-2',
				orgId: 'org-1',
				role: 'member',
			});
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.update({ id: 'user-2', name: 'Updated Name' });

			expect(mockUpdateUser).toHaveBeenCalledWith(
				'user-2',
				{ name: 'Updated Name' },
				{
					syncHomeOrgMembership: { orgId: 'org-1' },
				},
			);
		});

		it('allows sparse update for email', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'member' });
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.update({ id: 'user-2', email: 'updated@example.com' });

			expect(mockUpdateUser).toHaveBeenCalledWith(
				'user-2',
				{ email: 'updated@example.com' },
				{
					syncHomeOrgMembership: { orgId: 'org-1' },
				},
			);
		});

		it('hashes password when provided', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'member' });
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.update({ id: 'user-2', password: 'newpassword12' });

			expect(mockBcryptHash).toHaveBeenCalledWith('newpassword12', 10);
			expect(mockUpdateUser).toHaveBeenCalledWith(
				'user-2',
				{ passwordHash: 'hashed-password' },
				{
					syncHomeOrgMembership: { orgId: 'org-1' },
				},
			);
		});

		it('prevents self-demotion (cannot change own role)', async () => {
			mockGetUserById.mockResolvedValue({
				id: 'user-1',
				orgId: 'org-1',
				role: 'admin',
			});
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.update({ id: 'user-1', role: 'member' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});

			expect(mockUpdateUser).not.toHaveBeenCalled();
		});

		it('throws NOT_FOUND when user does not exist', async () => {
			mockGetUserById.mockResolvedValue(null);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.update({ id: 'nonexistent', name: 'X' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when user belongs to different org', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-other', orgId: 'other-org', role: 'member' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.update({ id: 'user-other', name: 'X' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});

			expect(mockUpdateUser).not.toHaveBeenCalled();
		});

		it('prevents non-superadmin from assigning superadmin role', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'member' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.update({ id: 'user-2', role: 'superadmin' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});

			expect(mockUpdateUser).not.toHaveBeenCalled();
		});

		it('allows superadmin to assign superadmin role', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'member' });
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });

			await caller.update({ id: 'user-2', role: 'superadmin' });

			expect(mockUpdateUser).toHaveBeenCalledWith(
				'user-2',
				{ role: 'superadmin' },
				{
					syncHomeOrgMembership: { orgId: 'org-1' },
				},
			);
		});

		it('prevents non-superadmin from editing ANY field on a superadmin user (name)', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-super', orgId: 'org-1', role: 'superadmin' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.update({ id: 'user-super', name: 'Hacked Name' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});

			expect(mockUpdateUser).not.toHaveBeenCalled();
		});

		it('allows superadmin to edit another superadmin name', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-super2', orgId: 'org-1', role: 'superadmin' });
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });

			await caller.update({ id: 'user-super2', name: 'New Super Name' });

			expect(mockUpdateUser).toHaveBeenCalledWith(
				'user-super2',
				{ name: 'New Super Name' },
				{
					syncHomeOrgMembership: { orgId: 'org-1' },
				},
			);
		});

		it('prevents non-superadmin from revoking superadmin role', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'superadmin' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.update({ id: 'user-2', role: 'admin' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});

			expect(mockUpdateUser).not.toHaveBeenCalled();
		});

		it('allows superadmin to revoke superadmin role', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'superadmin' });
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });

			await caller.update({ id: 'user-2', role: 'admin' });

			expect(mockUpdateUser).toHaveBeenCalledWith(
				'user-2',
				{ role: 'admin' },
				{
					syncHomeOrgMembership: { orgId: 'org-1' },
				},
			);
		});

		it('member→admin promotion syncs the target home-org membership (PR #1441 review)', async () => {
			// The whole point of the fix: home-org permissions read org_memberships.role,
			// so the promotion must reach the target's home org or it is a silent no-op.
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'member' });
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.update({ id: 'user-2', role: 'admin' });

			expect(mockUpdateUser).toHaveBeenCalledWith(
				'user-2',
				{ role: 'admin' },
				{
					syncHomeOrgMembership: { orgId: 'org-1' },
				},
			);
		});

		it('rejects update password shorter than 12 characters', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'member' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.update({ id: 'user-2', password: 'tooshort' })).rejects.toThrow();

			expect(mockUpdateUser).not.toHaveBeenCalled();
		});

		it('accepts update password of exactly 12 characters', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'member' });
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.update({ id: 'user-2', password: 'exactly12chr' });

			expect(mockUpdateUser).toHaveBeenCalled();
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.update({ id: 'user-2', name: 'X' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('throws FORBIDDEN when user is a member', async () => {
			const caller = createCaller({ user: mockMember, effectiveOrgId: mockMember.orgId });
			await expect(caller.update({ id: 'user-2', name: 'X' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		});

		it('invalidates all sessions when password is changed', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'member' });
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.update({ id: 'user-2', password: 'newpassword12' });

			expect(mockDeleteUserSessions).toHaveBeenCalledWith('user-2');
		});

		it('does not invalidate sessions when password is not changed', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'member' });
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.update({ id: 'user-2', name: 'New Name' });

			expect(mockDeleteUserSessions).not.toHaveBeenCalled();
		});

		it('does not invalidate sessions when only role/email are changed', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'member' });
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.update({ id: 'user-2', email: 'new@example.com' });

			expect(mockDeleteUserSessions).not.toHaveBeenCalled();
		});
	});

	describe('delete', () => {
		it('deletes user after verifying org ownership', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'member' });
			mockDeleteUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.delete({ id: 'user-2' });

			expect(mockDeleteUser).toHaveBeenCalledWith('user-2');
		});

		it('prevents self-deletion', async () => {
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.delete({ id: 'user-1' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});

			expect(mockDeleteUser).not.toHaveBeenCalled();
		});

		it('throws NOT_FOUND when user does not exist', async () => {
			mockGetUserById.mockResolvedValue(null);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.delete({ id: 'nonexistent' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('throws NOT_FOUND when user belongs to different org', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-other', orgId: 'other-org', role: 'member' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.delete({ id: 'user-other' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});

			expect(mockDeleteUser).not.toHaveBeenCalled();
		});

		it('prevents non-superadmin from deleting superadmin user', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-super', orgId: 'org-1', role: 'superadmin' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.delete({ id: 'user-super' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});

			expect(mockDeleteUser).not.toHaveBeenCalled();
		});

		it('allows superadmin to delete another superadmin user', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-super2', orgId: 'org-1', role: 'superadmin' });
			mockDeleteUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });

			await caller.delete({ id: 'user-super2' });

			expect(mockDeleteUser).toHaveBeenCalledWith('user-super2');
		});

		it('throws UNAUTHORIZED when not authenticated', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.delete({ id: 'user-2' })).rejects.toMatchObject({
				code: 'UNAUTHORIZED',
			});
		});

		it('throws FORBIDDEN when user is a member', async () => {
			const caller = createCaller({ user: mockMember, effectiveOrgId: mockMember.orgId });
			await expect(caller.delete({ id: 'user-2' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		});
	});

	// "Remove from this org" — drop only the membership, never the account
	// (PR #1441 review: whole-account delete of a guest was a footgun).
	describe('removeFromOrg', () => {
		it('removes a guest membership in the effective org without deleting the account', async () => {
			mockGetUserById.mockResolvedValue({ id: 'guest-1', orgId: 'org-2', role: 'member' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			const result = await caller.removeFromOrg({ userId: 'guest-1' });

			expect(mockRemoveOrgMembership).toHaveBeenCalledWith('guest-1', 'org-1');
			expect(mockDeleteUser).not.toHaveBeenCalled();
			expect(result).toEqual({ userId: 'guest-1', orgId: 'org-1', removed: true });
		});

		it('prevents removing yourself from the org', async () => {
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.removeFromOrg({ userId: 'user-1' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
			expect(mockRemoveOrgMembership).not.toHaveBeenCalled();
		});

		it('throws NOT_FOUND when the target account does not exist', async () => {
			mockGetUserById.mockResolvedValue(null);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.removeFromOrg({ userId: 'ghost' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
			expect(mockRemoveOrgMembership).not.toHaveBeenCalled();
		});

		it('refuses to remove a user from their HOME org (delete the account instead)', async () => {
			// Home org == effective org → not a guest.
			mockGetUserById.mockResolvedValue({ id: 'home-1', orgId: 'org-1', role: 'member' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.removeFromOrg({ userId: 'home-1' })).rejects.toMatchObject({
				code: 'BAD_REQUEST',
			});
			expect(mockRemoveOrgMembership).not.toHaveBeenCalled();
		});

		it('throws NOT_FOUND when the target has no membership in this org', async () => {
			mockGetUserById.mockResolvedValue({ id: 'guest-1', orgId: 'org-2', role: 'member' });
			mockRemoveOrgMembership.mockResolvedValue({ removed: false });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.removeFromOrg({ userId: 'guest-1' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});

		it('prevents a non-superadmin from removing a superadmin account', async () => {
			mockGetUserById.mockResolvedValue({ id: 'super-guest', orgId: 'org-2', role: 'superadmin' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(caller.removeFromOrg({ userId: 'super-guest' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
			expect(mockRemoveOrgMembership).not.toHaveBeenCalled();
		});

		it('rejects a member caller (adminProcedure)', async () => {
			const caller = createCaller({ user: mockMember, effectiveOrgId: mockMember.orgId });

			await expect(caller.removeFromOrg({ userId: 'guest-1' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		});
	});

	// =====================================================================
	// Per-org role governs user management (spec 021 plan 2)
	//   AC #4: per-org role governs permissions
	//   AC #7: superadmin cross-org unchanged
	//   AC #8: an org admin can't act cross-org
	// =====================================================================
	describe('per-org role (spec 021 plan 2)', () => {
		it('list: an org admin switched to an org where they are only a member is denied (AC #8)', async () => {
			mockGetOrgMembership.mockResolvedValue({ orgId: 'org-2', role: 'member' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: 'org-2' });

			await expect(caller.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
			expect(mockListOrgMembers).not.toHaveBeenCalled();
			expect(mockGetOrgMembership).toHaveBeenCalledWith('user-1', 'org-2');
		});

		it('list: an admin in the switched org lists that org with the per-org admin role (AC #4)', async () => {
			mockGetOrgMembership.mockResolvedValue({ orgId: 'org-2', role: 'admin' });
			mockListOrgMembers.mockResolvedValue([]);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: 'org-2' });

			await caller.list();

			expect(mockListOrgMembers).toHaveBeenCalledWith('org-2', { excludeGlobalRole: 'superadmin' });
		});

		it('create: an org admin switched to a member-org cannot create users there (AC #8)', async () => {
			mockGetOrgMembership.mockResolvedValue({ orgId: 'org-2', role: 'member' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: 'org-2' });

			await expect(
				caller.create({ email: 'x@example.com', name: 'X', password: 'secret123456789' }),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
			expect(mockCreateUserWithMembership).not.toHaveBeenCalled();
		});

		it('update: an org admin switched to a member-org cannot edit users there (AC #8)', async () => {
			mockGetOrgMembership.mockResolvedValue({ orgId: 'org-2', role: 'member' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: 'org-2' });

			await expect(caller.update({ id: 'user-2', name: 'X' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
			// Denied before the target is even loaded.
			expect(mockGetUserById).not.toHaveBeenCalled();
			expect(mockUpdateUser).not.toHaveBeenCalled();
		});

		it('delete: an org admin switched to a member-org cannot delete users there (AC #8)', async () => {
			mockGetOrgMembership.mockResolvedValue({ orgId: 'org-2', role: 'member' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: 'org-2' });

			await expect(caller.delete({ id: 'user-2' })).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
			expect(mockDeleteUser).not.toHaveBeenCalled();
		});

		it('superadmin acts in any org without a membership row (AC #7)', async () => {
			// No membership in org-2; the global superadmin role short-circuits the
			// per-org resolver, so getOrgMembership is never consulted.
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-2', role: 'member' });
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: 'org-2' });

			await caller.update({ id: 'user-2', name: 'Renamed' });

			expect(mockUpdateUser).toHaveBeenCalledWith(
				'user-2',
				{ name: 'Renamed' },
				{
					syncHomeOrgMembership: { orgId: 'org-2' },
				},
			);
			expect(mockGetOrgMembership).not.toHaveBeenCalled();
		});
	});
});

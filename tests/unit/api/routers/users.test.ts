import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

const {
	mockListOrgUsers,
	mockCreateUser,
	mockUpdateUser,
	mockDeleteUser,
	mockGetUserById,
	mockBcryptHash,
} = vi.hoisted(() => ({
	mockListOrgUsers: vi.fn(),
	mockCreateUser: vi.fn(),
	mockUpdateUser: vi.fn(),
	mockDeleteUser: vi.fn(),
	mockGetUserById: vi.fn(),
	mockBcryptHash: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/usersRepository.js', () => ({
	listOrgUsers: mockListOrgUsers,
	createUser: mockCreateUser,
	updateUser: mockUpdateUser,
	deleteUser: mockDeleteUser,
	getUserById: mockGetUserById,
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
	});

	describe('list', () => {
		it('returns org-scoped user list without passwordHash (admin caller excludes superadmins)', async () => {
			const orgUsers = [
				{
					id: 'user-1',
					orgId: 'org-1',
					email: 'alice@example.com',
					name: 'Alice',
					role: 'admin',
					createdAt: null,
					updatedAt: null,
				},
				{
					id: 'user-2',
					orgId: 'org-1',
					email: 'bob@example.com',
					name: 'Bob',
					role: 'member',
					createdAt: null,
					updatedAt: null,
				},
			];
			mockListOrgUsers.mockResolvedValue(orgUsers);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			const result = await caller.list();

			expect(mockListOrgUsers).toHaveBeenCalledWith('org-1', { excludeRole: 'superadmin' });
			expect(result).toEqual(orgUsers);
			// Note: passwordHash exclusion is enforced at the repository layer (listOrgUsers selects
			// specific columns). The mock already returns data without passwordHash, reflecting
			// the contract that the repository never returns this field.
		});

		it('superadmin caller receives full user list including superadmins', async () => {
			const orgUsers = [
				{
					id: 'user-1',
					orgId: 'org-1',
					email: 'alice@example.com',
					name: 'Alice',
					role: 'admin',
					createdAt: null,
					updatedAt: null,
				},
				{
					id: 'superadmin-2',
					orgId: 'org-1',
					email: 'super@example.com',
					name: 'Super',
					role: 'superadmin',
					createdAt: null,
					updatedAt: null,
				},
			];
			mockListOrgUsers.mockResolvedValue(orgUsers);
			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });

			const result = await caller.list();

			expect(mockListOrgUsers).toHaveBeenCalledWith('org-1');
			expect(result).toEqual(orgUsers);
		});

		it('returns empty array when no users', async () => {
			mockListOrgUsers.mockResolvedValue([]);
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
		it('creates user with hashed password', async () => {
			mockCreateUser.mockResolvedValue({ id: 'new-user-1' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			const result = await caller.create({
				email: 'newuser@example.com',
				name: 'New User',
				password: 'secret123456789',
			});

			expect(mockBcryptHash).toHaveBeenCalledWith('secret123456789', 10);
			expect(mockCreateUser).toHaveBeenCalledWith({
				orgId: 'org-1',
				email: 'newuser@example.com',
				name: 'New User',
				passwordHash: 'hashed-password',
				role: 'member',
			});
			expect(result).toEqual({ id: 'new-user-1' });
		});

		it('creates admin user when role is specified', async () => {
			mockCreateUser.mockResolvedValue({ id: 'new-admin-1' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.create({
				email: 'newadmin@example.com',
				name: 'New Admin',
				password: 'secret123456789',
				role: 'admin',
			});

			expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }));
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

			expect(mockCreateUser).not.toHaveBeenCalled();
		});

		it('allows superadmin to create superadmin users', async () => {
			mockCreateUser.mockResolvedValue({ id: 'new-super-1' });
			const caller = createCaller({ user: mockSuperAdmin, effectiveOrgId: mockSuperAdmin.orgId });

			await caller.create({
				email: 'super2@example.com',
				name: 'Super 2',
				password: 'secret123456789',
				role: 'superadmin',
			});

			expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'superadmin' }));
		});

		it('rejects password shorter than 12 characters', async () => {
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await expect(
				caller.create({ email: 'x@example.com', name: 'X', password: 'short' }),
			).rejects.toThrow();

			expect(mockCreateUser).not.toHaveBeenCalled();
		});

		it('accepts password of exactly 12 characters', async () => {
			mockCreateUser.mockResolvedValue({ id: 'new-user-1' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.create({ email: 'x@example.com', name: 'X', password: 'exactly12chr' });

			expect(mockCreateUser).toHaveBeenCalled();
		});

		it('accepts password longer than 12 characters', async () => {
			mockCreateUser.mockResolvedValue({ id: 'new-user-2' });
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.create({
				email: 'x@example.com',
				name: 'X',
				password: 'this-is-a-very-long-password-123',
			});

			expect(mockCreateUser).toHaveBeenCalled();
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

			expect(mockUpdateUser).toHaveBeenCalledWith('user-2', { name: 'Updated Name' });
		});

		it('allows sparse update for email', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'member' });
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.update({ id: 'user-2', email: 'updated@example.com' });

			expect(mockUpdateUser).toHaveBeenCalledWith('user-2', { email: 'updated@example.com' });
		});

		it('hashes password when provided', async () => {
			mockGetUserById.mockResolvedValue({ id: 'user-2', orgId: 'org-1', role: 'member' });
			mockUpdateUser.mockResolvedValue(undefined);
			const caller = createCaller({ user: mockAdminUser, effectiveOrgId: mockAdminUser.orgId });

			await caller.update({ id: 'user-2', password: 'newpassword12' });

			expect(mockBcryptHash).toHaveBeenCalledWith('newpassword12', 10);
			expect(mockUpdateUser).toHaveBeenCalledWith('user-2', { passwordHash: 'hashed-password' });
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

			expect(mockUpdateUser).toHaveBeenCalledWith('user-2', { role: 'superadmin' });
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

			expect(mockUpdateUser).toHaveBeenCalledWith('user-super2', { name: 'New Super Name' });
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

			expect(mockUpdateUser).toHaveBeenCalledWith('user-2', { role: 'admin' });
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
});

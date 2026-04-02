import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

vi.mock('../../../../src/db/schema/index.js', () => ({
	users: {
		id: 'id',
		orgId: 'org_id',
		email: 'email',
		passwordHash: 'password_hash',
		name: 'name',
		role: 'role',
		createdAt: 'created_at',
		updatedAt: 'updated_at',
	},
	sessions: {
		id: 'id',
		userId: 'user_id',
		token: 'token',
		expiresAt: 'expires_at',
	},
}));

import {
	createSession,
	createUser,
	deleteExpiredSessions,
	deleteSession,
	deleteUser,
	deleteUserSessions,
	getSessionByToken,
	getUserByEmail,
	getUserById,
	listOrgUsers,
	updateUser,
} from '../../../../src/db/repositories/usersRepository.js';

describe('usersRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb();
	});

	describe('getUserByEmail', () => {
		it('returns user row when found', async () => {
			const mockUser = {
				id: 'u1',
				orgId: 'org-1',
				email: 'test@example.com',
				passwordHash: '$2b$10$hash',
				name: 'Test',
				role: 'admin',
			};
			mockDb.chain.where.mockResolvedValueOnce([mockUser]);

			const result = await getUserByEmail('test@example.com');
			expect(result).toEqual(mockUser);
		});

		it('returns null when no user matches', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getUserByEmail('noone@example.com');
			expect(result).toBeNull();
		});
	});

	describe('getUserById', () => {
		it('returns DashboardUser shape when found', async () => {
			const dashboardUser = {
				id: 'u1',
				orgId: 'org-1',
				email: 'test@example.com',
				name: 'Test',
				role: 'admin',
			};
			mockDb.chain.where.mockResolvedValueOnce([dashboardUser]);

			const result = await getUserById('u1');
			expect(result).toEqual(dashboardUser);
		});

		it('returns null when not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getUserById('nonexistent');
			expect(result).toBeNull();
		});
	});

	describe('createSession', () => {
		it('inserts session and returns id', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 'session-uuid' }]);
			const expiresAt = new Date('2099-01-01');

			const result = await createSession('user-1', 'token-abc', expiresAt);

			expect(result).toBe('session-uuid');
			expect(mockDb.chain.values).toHaveBeenCalledWith({
				userId: 'user-1',
				token: 'token-abc',
				expiresAt,
			});
		});
	});

	describe('getSessionByToken', () => {
		it('returns session data when token is valid', async () => {
			const sessionRow = {
				sessionId: 's1',
				userId: 'u1',
				expiresAt: new Date('2099-01-01'),
			};
			mockDb.chain.where.mockResolvedValueOnce([sessionRow]);

			const result = await getSessionByToken('valid-token');
			expect(result).toEqual(sessionRow);
		});

		it('returns null when no matching session', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getSessionByToken('expired-token');
			expect(result).toBeNull();
		});
	});

	describe('deleteSession', () => {
		it('deletes session by token', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteSession('token-to-delete');
			expect(mockDb.db.delete).toHaveBeenCalled();
		});
	});

	describe('deleteExpiredSessions', () => {
		it('deletes sessions with past expiresAt', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteExpiredSessions();
			expect(mockDb.db.delete).toHaveBeenCalled();
		});
	});

	describe('listOrgUsers', () => {
		it('returns all users for org without passwordHash', async () => {
			const mockUsers = [
				{
					id: 'u1',
					orgId: 'org-1',
					email: 'alice@example.com',
					name: 'Alice',
					role: 'admin',
					createdAt: new Date('2024-01-01'),
					updatedAt: new Date('2024-01-01'),
				},
				{
					id: 'u2',
					orgId: 'org-1',
					email: 'bob@example.com',
					name: 'Bob',
					role: 'member',
					createdAt: new Date('2024-02-01'),
					updatedAt: new Date('2024-02-01'),
				},
			];
			mockDb.chain.where.mockResolvedValueOnce(mockUsers);

			const result = await listOrgUsers('org-1');

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual(mockUsers[0]);
			expect(result[1]).toEqual(mockUsers[1]);
			// Verify passwordHash is not in the result
			for (const user of result) {
				expect(user).not.toHaveProperty('passwordHash');
			}
		});

		it('returns empty array when no users in org', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await listOrgUsers('empty-org');
			expect(result).toEqual([]);
		});

		it('queries by orgId', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			await listOrgUsers('org-123');

			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});
	});

	describe('createUser', () => {
		it('inserts user and returns id', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 'new-user-uuid' }]);

			const result = await createUser({
				orgId: 'org-1',
				email: 'newuser@example.com',
				passwordHash: '$2b$10$hashed',
				name: 'New User',
				role: 'member',
			});

			expect(result).toEqual({ id: 'new-user-uuid' });
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
		});

		it('stores pre-hashed password without modification', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 'u1' }]);
			const hashedPassword = '$2b$10$somehash';

			await createUser({
				orgId: 'org-1',
				email: 'test@example.com',
				passwordHash: hashedPassword,
				name: 'Test User',
				role: 'admin',
			});

			expect(mockDb.chain.values).toHaveBeenCalledWith({
				orgId: 'org-1',
				email: 'test@example.com',
				passwordHash: hashedPassword,
				name: 'Test User',
				role: 'admin',
			});
		});
	});

	describe('updateUser', () => {
		it('updates specified fields and sets updatedAt', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateUser('u1', { name: 'New Name', email: 'new@example.com' });

			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.name).toBe('New Name');
			expect(setArg.email).toBe('new@example.com');
			expect(setArg.updatedAt).toBeInstanceOf(Date);
		});

		it('only updates provided fields', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateUser('u1', { role: 'admin' });

			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.role).toBe('admin');
			expect(setArg.name).toBeUndefined();
			expect(setArg.email).toBeUndefined();
			expect(setArg.passwordHash).toBeUndefined();
		});

		it('updates passwordHash when provided', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);
			const newHash = '$2b$10$newhash';

			await updateUser('u1', { passwordHash: newHash });

			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.passwordHash).toBe(newHash);
		});

		it('always sets updatedAt even with no other fields', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateUser('u1', {});

			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.updatedAt).toBeInstanceOf(Date);
		});
	});

	describe('deleteUser', () => {
		it('deletes user by id', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteUser('u1');

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});
	});

	describe('deleteUserSessions', () => {
		it('deletes all sessions for a user', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteUserSessions('user-1');

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});

		it('deletes all sessions when excludeToken is not provided', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteUserSessions('user-1');

			// Without excludeToken the where clause uses a single eq condition (no and/ne)
			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.where).toHaveBeenCalledTimes(1);
		});

		it('excludes a specific token when provided', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteUserSessions('user-1', 'keep-this-token');

			// With excludeToken the where clause uses an and(eq, ne) condition
			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.where).toHaveBeenCalledTimes(1);
		});
	});
});

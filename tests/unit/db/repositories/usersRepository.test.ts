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
		activeOrgId: 'active_org_id',
	},
	orgMemberships: {
		id: 'id',
		userId: 'user_id',
		orgId: 'org_id',
		role: 'role',
	},
}));

import {
	createSession,
	createUserWithMembership,
	deleteExpiredSessions,
	deleteSession,
	deleteUser,
	deleteUserSessions,
	getSessionByToken,
	getUserByEmail,
	getUserById,
	setSessionActiveOrg,
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

	describe('setSessionActiveOrg', () => {
		it('updates the active org on the session by token', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await setSessionActiveOrg('session-token', 'org-2');

			expect(mockDb.db.update).toHaveBeenCalled();
			expect(mockDb.chain.set).toHaveBeenCalledWith({ activeOrgId: 'org-2' });
		});

		it('clears the active org when passed null', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await setSessionActiveOrg('session-token', null);

			expect(mockDb.chain.set).toHaveBeenCalledWith({ activeOrgId: null });
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

	describe('createUserWithMembership', () => {
		/**
		 * createUserWithMembership runs both inserts inside db.transaction(). Mock
		 * the transaction to invoke its callback with a tx whose insert chain we
		 * can assert on (mirrors the agentTriggerConfigs transaction test pattern).
		 */
		function mockTransaction() {
			const txChain: Record<string, ReturnType<typeof vi.fn>> = {};
			txChain.returning = vi.fn().mockResolvedValue([{ id: 'new-user-uuid' }]);
			txChain.values = vi.fn().mockReturnValue({ returning: txChain.returning });
			const txInsert = vi.fn().mockReturnValue({ values: txChain.values });
			const tx = { insert: txInsert };
			(mockDb.db as unknown as Record<string, unknown>).transaction = vi
				.fn()
				.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
			return { txChain, txInsert };
		}

		it('inserts the user and the membership and returns the new id', async () => {
			const { txChain, txInsert } = mockTransaction();

			const result = await createUserWithMembership({
				orgId: 'org-1',
				email: 'newuser@example.com',
				passwordHash: '$2b$10$hashed',
				name: 'New User',
				role: 'member',
				membershipRole: 'member',
			});

			expect(result).toEqual({ id: 'new-user-uuid' });
			// One insert for users, one for org_memberships — same transaction.
			expect(txInsert).toHaveBeenCalledTimes(2);
			expect(txChain.values).toHaveBeenCalledWith({
				orgId: 'org-1',
				email: 'newuser@example.com',
				passwordHash: '$2b$10$hashed',
				name: 'New User',
				role: 'member',
			});
			expect(txChain.values).toHaveBeenCalledWith({
				userId: 'new-user-uuid',
				orgId: 'org-1',
				role: 'member',
			});
		});

		it('grants the membership with the mapped per-org role (superadmin → admin)', async () => {
			const { txChain } = mockTransaction();

			await createUserWithMembership({
				orgId: 'org-1',
				email: 'super@example.com',
				passwordHash: '$2b$10$somehash',
				name: 'Super User',
				role: 'superadmin',
				membershipRole: 'admin',
			});

			// users insert keeps the global role…
			expect(txChain.values).toHaveBeenCalledWith(expect.objectContaining({ role: 'superadmin' }));
			// …while the membership gets the per-org role.
			expect(txChain.values).toHaveBeenCalledWith({
				userId: 'new-user-uuid',
				orgId: 'org-1',
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

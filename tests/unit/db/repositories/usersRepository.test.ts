import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();

vi.mock('../../../../src/db/client.js', () => ({
	getDb: () => ({
		insert: mockInsert,
		select: mockSelect,
		delete: mockDelete,
	}),
}));

vi.mock('../../../../src/db/schema/index.js', () => ({
	users: {
		id: 'id',
		orgId: 'org_id',
		email: 'email',
		passwordHash: 'password_hash',
		name: 'name',
		role: 'role',
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
	deleteExpiredSessions,
	deleteSession,
	getSessionByToken,
	getUserByEmail,
	getUserById,
} from '../../../../src/db/repositories/usersRepository.js';

describe('usersRepository', () => {
	beforeEach(() => {
		mockInsert.mockReturnValue({ values: mockValues });
		mockValues.mockReturnValue({ returning: mockReturning });
		mockSelect.mockReturnValue({ from: mockFrom });
		mockFrom.mockReturnValue({ where: mockWhere });
		mockDelete.mockReturnValue({ where: mockWhere });
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
			mockWhere.mockResolvedValue([mockUser]);

			const result = await getUserByEmail('test@example.com');
			expect(result).toEqual(mockUser);
		});

		it('returns null when no user matches', async () => {
			mockWhere.mockResolvedValue([]);

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
			mockWhere.mockResolvedValue([dashboardUser]);

			const result = await getUserById('u1');
			expect(result).toEqual(dashboardUser);
		});

		it('returns null when not found', async () => {
			mockWhere.mockResolvedValue([]);

			const result = await getUserById('nonexistent');
			expect(result).toBeNull();
		});
	});

	describe('createSession', () => {
		it('inserts session and returns id', async () => {
			mockReturning.mockResolvedValue([{ id: 'session-uuid' }]);
			const expiresAt = new Date('2099-01-01');

			const result = await createSession('user-1', 'token-abc', expiresAt);

			expect(result).toBe('session-uuid');
			expect(mockValues).toHaveBeenCalledWith({
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
			mockWhere.mockResolvedValue([sessionRow]);

			const result = await getSessionByToken('valid-token');
			expect(result).toEqual(sessionRow);
		});

		it('returns null when no matching session', async () => {
			mockWhere.mockResolvedValue([]);

			const result = await getSessionByToken('expired-token');
			expect(result).toBeNull();
		});
	});

	describe('deleteSession', () => {
		it('deletes session by token', async () => {
			mockWhere.mockResolvedValue(undefined);

			await deleteSession('token-to-delete');
			expect(mockDelete).toHaveBeenCalled();
		});
	});

	describe('deleteExpiredSessions', () => {
		it('deletes sessions with past expiresAt', async () => {
			mockWhere.mockResolvedValue(undefined);

			await deleteExpiredSessions();
			expect(mockDelete).toHaveBeenCalled();
		});
	});
});

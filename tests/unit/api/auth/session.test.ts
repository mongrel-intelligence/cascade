import { describe, expect, it, vi } from 'vitest';

const mockGetSessionByToken = vi.fn();
const mockGetUserById = vi.fn();

vi.mock('../../../../src/db/repositories/usersRepository.js', () => ({
	getSessionByToken: (...args: unknown[]) => mockGetSessionByToken(...args),
	getUserById: (...args: unknown[]) => mockGetUserById(...args),
}));

import { resolveUserFromSession } from '../../../../src/api/auth/session.js';

describe('resolveUserFromSession', () => {
	const mockUser = {
		id: 'user-1',
		orgId: 'org-1',
		email: 'test@example.com',
		name: 'Test User',
		role: 'admin',
	};

	it('returns the user and active org when token maps to a valid session', async () => {
		mockGetSessionByToken.mockResolvedValue({
			sessionId: 'session-1',
			userId: 'user-1',
			expiresAt: new Date('2099-01-01'),
			activeOrgId: 'org-2',
		});
		mockGetUserById.mockResolvedValue(mockUser);

		const result = await resolveUserFromSession('valid-token');

		expect(mockGetSessionByToken).toHaveBeenCalledWith('valid-token');
		expect(mockGetUserById).toHaveBeenCalledWith('user-1');
		expect(result).toEqual({ user: mockUser, activeOrgId: 'org-2' });
	});

	it('returns activeOrgId null when the session has no active org (no-logout default)', async () => {
		mockGetSessionByToken.mockResolvedValue({
			sessionId: 'session-1',
			userId: 'user-1',
			expiresAt: new Date('2099-01-01'),
			activeOrgId: null,
		});
		mockGetUserById.mockResolvedValue(mockUser);

		const result = await resolveUserFromSession('valid-token');

		expect(result).toEqual({ user: mockUser, activeOrgId: null });
	});

	it('returns null when session not found', async () => {
		mockGetSessionByToken.mockResolvedValue(null);

		const result = await resolveUserFromSession('invalid-token');

		expect(result).toBeNull();
		expect(mockGetUserById).not.toHaveBeenCalled();
	});

	it('returns null when session exists but user not found', async () => {
		mockGetSessionByToken.mockResolvedValue({
			sessionId: 'session-1',
			userId: 'deleted-user',
			expiresAt: new Date('2099-01-01'),
			activeOrgId: null,
		});
		mockGetUserById.mockResolvedValue(null);

		const result = await resolveUserFromSession('orphan-token');

		expect(result).toBeNull();
	});
});

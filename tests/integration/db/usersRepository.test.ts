import { beforeEach, describe, expect, it } from 'vitest';
import {
	createSession,
	deleteExpiredSessions,
	deleteSession,
	getSessionByToken,
	getUserByEmail,
	getUserById,
} from '../../../src/db/repositories/usersRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject, seedSession, seedUser } from '../helpers/seed.js';

describe('usersRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// getUserByEmail
	// =========================================================================

	describe('getUserByEmail', () => {
		it('returns the user for an existing email', async () => {
			await seedUser({ email: 'alice@example.com', name: 'Alice' });

			const user = await getUserByEmail('alice@example.com');
			expect(user).toBeDefined();
			expect(user?.email).toBe('alice@example.com');
			expect(user?.name).toBe('Alice');
		});

		it('returns null for non-existent email', async () => {
			const user = await getUserByEmail('nobody@example.com');
			expect(user).toBeNull();
		});

		it('returns the password hash (needed for auth)', async () => {
			await seedUser({ email: 'bob@example.com', passwordHash: '$2b$10$abcdefghij' });
			const user = await getUserByEmail('bob@example.com');
			expect(user?.passwordHash).toBe('$2b$10$abcdefghij');
		});
	});

	// =========================================================================
	// getUserById
	// =========================================================================

	describe('getUserById', () => {
		it('returns the user without password hash', async () => {
			const seeded = await seedUser({ email: 'carol@example.com', name: 'Carol', role: 'admin' });

			const user = await getUserById(seeded.id);
			expect(user).toBeDefined();
			expect(user?.id).toBe(seeded.id);
			expect(user?.email).toBe('carol@example.com');
			expect(user?.name).toBe('Carol');
			expect(user?.role).toBe('admin');
			expect(user?.orgId).toBe('test-org');
			// getUserById returns DashboardUser which doesn't have passwordHash
			expect('passwordHash' in (user ?? {})).toBe(false);
		});

		it('returns null for non-existent ID', async () => {
			const user = await getUserById('00000000-0000-0000-0000-000000000000');
			expect(user).toBeNull();
		});
	});

	// =========================================================================
	// createSession / getSessionByToken
	// =========================================================================

	describe('createSession', () => {
		it('creates a session and returns the ID', async () => {
			const user = await seedUser({ email: 'dave@example.com' });
			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() + 30);

			const sessionId = await createSession(user.id, 'my-session-token', expiresAt);
			expect(sessionId).toBeTruthy();
		});
	});

	describe('getSessionByToken', () => {
		it('returns session for valid non-expired token', async () => {
			const user = await seedUser({ email: 'eve@example.com' });
			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() + 30);

			await createSession(user.id, 'valid-token', expiresAt);

			const session = await getSessionByToken('valid-token');
			expect(session).toBeDefined();
			expect(session?.userId).toBe(user.id);
		});

		it('returns null for expired token', async () => {
			const user = await seedUser({ email: 'frank@example.com' });
			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() - 1); // expired yesterday

			await createSession(user.id, 'expired-token', expiresAt);

			const session = await getSessionByToken('expired-token');
			expect(session).toBeNull();
		});

		it('returns null for non-existent token', async () => {
			const session = await getSessionByToken('nonexistent-token');
			expect(session).toBeNull();
		});
	});

	// =========================================================================
	// deleteSession
	// =========================================================================

	describe('deleteSession', () => {
		it('removes the session', async () => {
			const user = await seedUser({ email: 'grace@example.com' });
			await seedSession({ userId: user.id, token: 'to-delete-token' });

			await deleteSession('to-delete-token');

			const session = await getSessionByToken('to-delete-token');
			expect(session).toBeNull();
		});

		it('does nothing when deleting non-existent token', async () => {
			await expect(deleteSession('nonexistent-token')).resolves.toBeUndefined();
		});
	});

	// =========================================================================
	// deleteExpiredSessions
	// =========================================================================

	describe('deleteExpiredSessions', () => {
		it('removes expired sessions only', async () => {
			const user = await seedUser({ email: 'henry@example.com' });

			const validExpiry = new Date();
			validExpiry.setDate(validExpiry.getDate() + 30);
			const expiredExpiry = new Date();
			expiredExpiry.setDate(expiredExpiry.getDate() - 1);

			await seedSession({ userId: user.id, token: 'valid-session', expiresAt: validExpiry });
			await seedSession({ userId: user.id, token: 'expired-session-1', expiresAt: expiredExpiry });
			await seedSession({ userId: user.id, token: 'expired-session-2', expiresAt: expiredExpiry });

			await deleteExpiredSessions();

			// Valid session still exists
			const validSession = await getSessionByToken('valid-session');
			expect(validSession).toBeDefined();

			// Expired sessions are gone
			const expired1 = await getSessionByToken('expired-session-1');
			expect(expired1).toBeNull();
			const expired2 = await getSessionByToken('expired-session-2');
			expect(expired2).toBeNull();
		});
	});
});

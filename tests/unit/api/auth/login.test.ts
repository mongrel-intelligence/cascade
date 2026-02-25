import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUserByEmail = vi.fn();
const mockCreateSession = vi.fn();
const mockBcryptCompare = vi.fn();

vi.mock('../../../../src/db/repositories/usersRepository.js', () => ({
	getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
	createSession: (...args: unknown[]) => mockCreateSession(...args),
}));

vi.mock('bcrypt', () => ({
	default: {
		compare: (...args: unknown[]) => mockBcryptCompare(...args),
	},
}));

import { loginHandler } from '../../../../src/api/auth/login.js';

function createTestApp() {
	const app = new Hono();
	app.post('/api/auth/login', loginHandler);
	return app;
}

function postLogin(app: Hono, body: Record<string, unknown>) {
	return app.request('/api/auth/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

const mockUser = {
	id: 'user-1',
	orgId: 'org-1',
	email: 'test@example.com',
	passwordHash: '$2b$10$hash',
	name: 'Test User',
	role: 'admin',
};

describe('loginHandler', () => {
	it('returns 400 when email is missing', async () => {
		const app = createTestApp();
		const res = await postLogin(app, { password: 'pass' });

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe('Email and password are required');
	});

	it('returns 400 when password is missing', async () => {
		const app = createTestApp();
		const res = await postLogin(app, { email: 'a@b.com' });

		expect(res.status).toBe(400);
	});

	it('returns 401 when user not found', async () => {
		mockGetUserByEmail.mockResolvedValue(null);
		const app = createTestApp();

		const res = await postLogin(app, { email: 'noone@b.com', password: 'pass' });

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe('Invalid credentials');
	});

	it('returns 401 when password does not match', async () => {
		mockGetUserByEmail.mockResolvedValue(mockUser);
		mockBcryptCompare.mockResolvedValue(false);
		const app = createTestApp();

		const res = await postLogin(app, { email: 'test@example.com', password: 'wrong' });

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe('Invalid credentials');
	});

	it('returns 200 with user data and sets session cookie on success', async () => {
		mockGetUserByEmail.mockResolvedValue(mockUser);
		mockBcryptCompare.mockResolvedValue(true);
		mockCreateSession.mockResolvedValue('session-id');
		const app = createTestApp();

		const res = await postLogin(app, { email: 'test@example.com', password: 'correct' });

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({
			id: 'user-1',
			email: 'test@example.com',
			name: 'Test User',
			role: 'admin',
		});

		// Check Set-Cookie header
		const cookie = res.headers.get('set-cookie');
		expect(cookie).toBeTruthy();
		expect(cookie).toContain('cascade_session=');
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('Path=/');
	});

	it('creates session with 30-day expiry', async () => {
		mockGetUserByEmail.mockResolvedValue(mockUser);
		mockBcryptCompare.mockResolvedValue(true);
		mockCreateSession.mockResolvedValue('session-id');
		const app = createTestApp();

		await postLogin(app, { email: 'test@example.com', password: 'correct' });

		expect(mockCreateSession).toHaveBeenCalledTimes(1);
		const [userId, _token, expiresAt] = mockCreateSession.mock.calls[0];
		expect(userId).toBe('user-1');
		// Expiry should be ~30 days from now
		const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
		const expectedExpiry = Date.now() + thirtyDaysMs;
		expect(Math.abs(expiresAt.getTime() - expectedExpiry)).toBeLessThan(5000);
	});
});

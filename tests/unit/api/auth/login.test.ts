import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUserByEmail = vi.fn();
const mockCreateSession = vi.fn();
const mockBcryptCompare = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockRecordSuccessfulLogin = vi.fn();

vi.mock('../../../../src/db/repositories/usersRepository.js', () => ({
	getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
	createSession: (...args: unknown[]) => mockCreateSession(...args),
}));

vi.mock('bcrypt', () => ({
	default: {
		compare: (...args: unknown[]) => mockBcryptCompare(...args),
	},
}));

vi.mock('../../../../src/api/auth/rateLimiter.js', () => ({
	checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
	recordSuccessfulLogin: (...args: unknown[]) => mockRecordSuccessfulLogin(...args),
}));

import { SESSION_COOKIE_NAME } from '../../../../src/api/auth/cookie.js';
import { loginHandler } from '../../../../src/api/auth/login.js';

function createTestApp() {
	const app = new Hono();
	app.post('/api/auth/login', loginHandler);
	return app;
}

function postLogin(app: Hono, body: Record<string, unknown>, headers?: Record<string, string>) {
	return app.request('/api/auth/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
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
	beforeEach(() => {
		// Default: not rate-limited
		mockCheckRateLimit.mockReturnValue({ limited: false });
		mockRecordSuccessfulLogin.mockReturnValue(undefined);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

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
		expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
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

	describe('rate limiting', () => {
		it('returns 429 when the rate limit is exceeded', async () => {
			mockCheckRateLimit.mockReturnValue({ limited: true, retryAfterSeconds: 45 });
			const app = createTestApp();

			const res = await postLogin(app, { email: 'test@example.com', password: 'pass' });

			expect(res.status).toBe(429);
			const body = await res.json();
			expect(body.error).toMatch(/too many/i);
		});

		it('includes Retry-After header when rate-limited', async () => {
			mockCheckRateLimit.mockReturnValue({ limited: true, retryAfterSeconds: 30 });
			const app = createTestApp();

			const res = await postLogin(app, { email: 'test@example.com', password: 'pass' });

			expect(res.headers.get('Retry-After')).toBe('30');
		});

		it('does not call getUserByEmail when rate-limited', async () => {
			mockCheckRateLimit.mockReturnValue({ limited: true, retryAfterSeconds: 10 });
			const app = createTestApp();

			await postLogin(app, { email: 'test@example.com', password: 'pass' });

			expect(mockGetUserByEmail).not.toHaveBeenCalled();
		});

		it('calls checkRateLimit with the IP from x-forwarded-for header', async () => {
			const app = createTestApp();

			await postLogin(
				app,
				{ email: 'test@example.com', password: 'pass' },
				{ 'x-forwarded-for': '203.0.113.42' },
			);

			expect(mockCheckRateLimit).toHaveBeenCalledWith('203.0.113.42');
		});

		it('uses the first IP when x-forwarded-for is a comma-separated list', async () => {
			const app = createTestApp();

			await postLogin(
				app,
				{ email: 'test@example.com', password: 'pass' },
				{ 'x-forwarded-for': '203.0.113.42, 10.0.0.1, 192.168.1.1' },
			);

			expect(mockCheckRateLimit).toHaveBeenCalledWith('203.0.113.42');
		});

		it('calls recordSuccessfulLogin on successful authentication', async () => {
			mockGetUserByEmail.mockResolvedValue(mockUser);
			mockBcryptCompare.mockResolvedValue(true);
			mockCreateSession.mockResolvedValue('session-id');
			const app = createTestApp();

			await postLogin(
				app,
				{ email: 'test@example.com', password: 'correct' },
				{ 'x-forwarded-for': '203.0.113.42' },
			);

			expect(mockRecordSuccessfulLogin).toHaveBeenCalledWith('203.0.113.42');
		});

		it('does not call recordSuccessfulLogin on failed authentication', async () => {
			mockGetUserByEmail.mockResolvedValue(mockUser);
			mockBcryptCompare.mockResolvedValue(false);
			const app = createTestApp();

			await postLogin(app, { email: 'test@example.com', password: 'wrong' });

			expect(mockRecordSuccessfulLogin).not.toHaveBeenCalled();
		});
	});
});

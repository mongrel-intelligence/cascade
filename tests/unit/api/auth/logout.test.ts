import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

const mockDeleteSession = vi.fn();

vi.mock('../../../../src/db/repositories/usersRepository.js', () => ({
	deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
}));

import { SESSION_COOKIE_NAME } from '../../../../src/api/auth/cookie.js';
import { logoutHandler } from '../../../../src/api/auth/logout.js';

function createTestApp() {
	const app = new Hono();
	app.post('/api/auth/logout', logoutHandler);
	return app;
}

describe('logoutHandler', () => {
	it('deletes session and clears cookie when session cookie is present', async () => {
		mockDeleteSession.mockResolvedValue(undefined);
		const app = createTestApp();

		const res = await app.request('/api/auth/logout', {
			method: 'POST',
			headers: { Cookie: `${SESSION_COOKIE_NAME}=abc123` },
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ ok: true });

		expect(mockDeleteSession).toHaveBeenCalledWith('abc123');

		// Cookie should be cleared
		const cookie = res.headers.get('set-cookie');
		expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
	});

	it('returns ok even when no session cookie is present', async () => {
		const app = createTestApp();

		const res = await app.request('/api/auth/logout', {
			method: 'POST',
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ ok: true });

		expect(mockDeleteSession).not.toHaveBeenCalled();
	});
});

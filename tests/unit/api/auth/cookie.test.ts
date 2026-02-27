import { describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE_NAME } from '../../../../src/api/auth/cookie.js';

describe('SESSION_COOKIE_NAME', () => {
	it('defaults to cascade_session when NODE_ENV is not set', async () => {
		vi.stubEnv('NODE_ENV', '');
		vi.resetModules();

		const { SESSION_COOKIE_NAME: name } = await import('../../../../src/api/auth/cookie.js');
		expect(name).toBe('cascade_session');
	});

	it('defaults to cascade_session when NODE_ENV is production', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.resetModules();

		const { SESSION_COOKIE_NAME: name } = await import('../../../../src/api/auth/cookie.js');
		expect(name).toBe('cascade_session');
	});

	it('appends environment name as suffix when NODE_ENV is not production', async () => {
		vi.stubEnv('NODE_ENV', 'development');
		vi.resetModules();

		const { SESSION_COOKIE_NAME: name } = await import('../../../../src/api/auth/cookie.js');
		expect(name).toBe('cascade_session_development');
	});

	it('appends custom environment name as suffix', async () => {
		vi.stubEnv('NODE_ENV', 'staging');
		vi.resetModules();

		const { SESSION_COOKIE_NAME: name } = await import('../../../../src/api/auth/cookie.js');
		expect(name).toBe('cascade_session_staging');
	});
});

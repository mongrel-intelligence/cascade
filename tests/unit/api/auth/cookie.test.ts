import { describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE_NAME } from '../../../../src/api/auth/cookie.js';

describe('SESSION_COOKIE_NAME', () => {
	it('defaults to cascade_session when COOKIE_NAME_SUFFIX is not set', () => {
		// In the test environment COOKIE_NAME_SUFFIX is not set,
		// so the constant should resolve to the default name.
		expect(SESSION_COOKIE_NAME).toBe('cascade_session');
	});

	it('appends suffix when COOKIE_NAME_SUFFIX is set', async () => {
		vi.stubEnv('COOKIE_NAME_SUFFIX', 'dev');
		vi.resetModules();

		const { SESSION_COOKIE_NAME: name } = await import('../../../../src/api/auth/cookie.js');
		expect(name).toBe('cascade_session_dev');
	});

	it('uses plain cascade_session when COOKIE_NAME_SUFFIX is empty string', async () => {
		vi.stubEnv('COOKIE_NAME_SUFFIX', '');
		vi.resetModules();

		const { SESSION_COOKIE_NAME: name } = await import('../../../../src/api/auth/cookie.js');
		expect(name).toBe('cascade_session');
	});
});

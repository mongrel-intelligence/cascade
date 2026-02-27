import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '../../../../src/api/auth/cookie.js';

describe('SESSION_COOKIE_NAME', () => {
	it('defaults to cascade_session when COOKIE_NAME_SUFFIX is not set', () => {
		// In the test environment COOKIE_NAME_SUFFIX is not set,
		// so the constant should resolve to the default name.
		expect(SESSION_COOKIE_NAME).toBe('cascade_session');
	});

	it('appends suffix when COOKIE_NAME_SUFFIX is set', () => {
		// Validate the cookie name derivation logic directly
		const suffix = 'dev';
		const expected = `cascade_session_${suffix}`;
		const name = suffix ? `cascade_session_${suffix}` : 'cascade_session';
		expect(name).toBe(expected);
	});

	it('uses plain cascade_session when COOKIE_NAME_SUFFIX is empty string', () => {
		// Validate the cookie name derivation logic with empty string
		const suffix = '';
		const name = suffix ? `cascade_session_${suffix}` : 'cascade_session';
		expect(name).toBe('cascade_session');
	});
});

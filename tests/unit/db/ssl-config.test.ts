import { afterEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted fs mock ───────────────────────────────────────────────────────────
const { mockReadFileSync, mockExistsSync } = vi.hoisted(() => ({
	mockReadFileSync: vi.fn().mockReturnValue('mock-ca-cert-content'),
	mockExistsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('node:fs', () => ({
	default: { readFileSync: mockReadFileSync },
	existsSync: mockExistsSync,
}));

import { applyDbSslModeToUrl, resolveDbSslConfig } from '../../../src/db/ssl-config.js';

describe('resolveDbSslConfig', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		mockReadFileSync.mockClear();
		mockExistsSync.mockClear();
		mockExistsSync.mockReturnValue(true);
	});

	it('returns false when DATABASE_SSL=false', () => {
		vi.stubEnv('DATABASE_SSL', 'false');
		expect(resolveDbSslConfig()).toBe(false);
	});

	it('returns { rejectUnauthorized: false } when DATABASE_SSL=no-verify', () => {
		vi.stubEnv('DATABASE_SSL', 'no-verify');
		vi.stubEnv('DATABASE_CA_CERT', '');
		expect(resolveDbSslConfig()).toEqual({ rejectUnauthorized: false });
	});

	it('ignores DATABASE_CA_CERT in no-verify mode (no file read)', () => {
		vi.stubEnv('DATABASE_SSL', 'no-verify');
		vi.stubEnv('DATABASE_CA_CERT', '/path/to/ca.pem');
		expect(resolveDbSslConfig()).toEqual({ rejectUnauthorized: false });
		expect(mockReadFileSync).not.toHaveBeenCalled();
	});

	it('returns { rejectUnauthorized: true } by default (DATABASE_SSL unset)', () => {
		vi.stubEnv('DATABASE_SSL', '');
		vi.stubEnv('DATABASE_CA_CERT', '');
		expect(resolveDbSslConfig()).toEqual({ rejectUnauthorized: true });
	});

	it('attaches CA cert when DATABASE_CA_CERT is set (verify mode)', () => {
		vi.stubEnv('DATABASE_SSL', '');
		vi.stubEnv('DATABASE_CA_CERT', '/path/to/ca.pem');
		expect(resolveDbSslConfig()).toEqual({ rejectUnauthorized: true, ca: 'mock-ca-cert-content' });
		expect(mockReadFileSync).toHaveBeenCalledWith('/path/to/ca.pem', 'utf8');
	});

	it('throws a descriptive error when DATABASE_CA_CERT path does not exist', () => {
		vi.stubEnv('DATABASE_SSL', '');
		vi.stubEnv('DATABASE_CA_CERT', '/nonexistent/ca.pem');
		mockExistsSync.mockReturnValueOnce(false);
		expect(() => resolveDbSslConfig()).toThrow(
			'DATABASE_CA_CERT file not found: /nonexistent/ca.pem',
		);
	});
});

describe('applyDbSslModeToUrl', () => {
	afterEach(() => vi.unstubAllEnvs());

	const URL = 'postgresql://u:p@host:5432/db';

	it('appends sslmode=no-verify when DATABASE_SSL=no-verify', () => {
		vi.stubEnv('DATABASE_SSL', 'no-verify');
		expect(applyDbSslModeToUrl(URL)).toBe(`${URL}?sslmode=no-verify`);
	});

	it('appends sslmode=disable when DATABASE_SSL=false', () => {
		vi.stubEnv('DATABASE_SSL', 'false');
		expect(applyDbSslModeToUrl(URL)).toBe(`${URL}?sslmode=disable`);
	});

	it('leaves the URL unchanged when DATABASE_SSL is unset (verify mode)', () => {
		vi.stubEnv('DATABASE_SSL', '');
		expect(applyDbSslModeToUrl(URL)).toBe(URL);
	});

	it('uses & when the URL already has a query string', () => {
		vi.stubEnv('DATABASE_SSL', 'no-verify');
		expect(applyDbSslModeToUrl(`${URL}?application_name=x`)).toBe(
			`${URL}?application_name=x&sslmode=no-verify`,
		);
	});

	it('does not override an sslmode already present in the URL', () => {
		vi.stubEnv('DATABASE_SSL', 'no-verify');
		const withMode = `${URL}?sslmode=require`;
		expect(applyDbSslModeToUrl(withMode)).toBe(withMode);
	});

	it('returns an empty URL unchanged', () => {
		vi.stubEnv('DATABASE_SSL', 'no-verify');
		expect(applyDbSslModeToUrl('')).toBe('');
	});
});

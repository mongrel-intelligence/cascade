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

import { resolveDbSslConfig } from '../../../src/db/ssl-config.js';

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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scrubSensitiveEnv } from '../../../src/utils/envScrub.js';

describe('scrubSensitiveEnv', () => {
	let savedEnv: Record<string, string | undefined>;

	beforeEach(() => {
		// Save original env values for restoration
		savedEnv = {
			CREDENTIAL_MASTER_KEY: process.env.CREDENTIAL_MASTER_KEY,
			DATABASE_URL: process.env.DATABASE_URL,
			DATABASE_SSL: process.env.DATABASE_SSL,
			REDIS_URL: process.env.REDIS_URL,
			CASCADE_CREDENTIALS: process.env.CASCADE_CREDENTIALS,
			CASCADE_CREDENTIALS_PROJECT_ID: process.env.CASCADE_CREDENTIALS_PROJECT_ID,
		};
	});

	afterEach(() => {
		// Restore original env values
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});

	it('removes CREDENTIAL_MASTER_KEY from process.env', () => {
		process.env.CREDENTIAL_MASTER_KEY = 'super-secret-key-abc123';
		scrubSensitiveEnv();
		expect(process.env.CREDENTIAL_MASTER_KEY).toBeUndefined();
	});

	it('removes DATABASE_URL from process.env', () => {
		process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
		scrubSensitiveEnv();
		expect(process.env.DATABASE_URL).toBeUndefined();
	});

	it('removes DATABASE_SSL from process.env', () => {
		process.env.DATABASE_SSL = 'false';
		scrubSensitiveEnv();
		expect(process.env.DATABASE_SSL).toBeUndefined();
	});

	it('removes REDIS_URL from process.env', () => {
		process.env.REDIS_URL = 'redis://localhost:6379';
		scrubSensitiveEnv();
		expect(process.env.REDIS_URL).toBeUndefined();
	});

	it('removes CASCADE_CREDENTIALS from process.env', () => {
		process.env.CASCADE_CREDENTIALS = 'eyJzb21lIjoianNvbiJ9';
		scrubSensitiveEnv();
		expect(process.env.CASCADE_CREDENTIALS).toBeUndefined();
	});

	it('removes CASCADE_CREDENTIALS_PROJECT_ID from process.env', () => {
		process.env.CASCADE_CREDENTIALS_PROJECT_ID = 'my-project-id';
		scrubSensitiveEnv();
		expect(process.env.CASCADE_CREDENTIALS_PROJECT_ID).toBeUndefined();
	});

	it('removes all sensitive keys in a single call', () => {
		process.env.CREDENTIAL_MASTER_KEY = 'key1';
		process.env.DATABASE_URL = 'postgres://...';
		process.env.DATABASE_SSL = 'true';
		process.env.REDIS_URL = 'redis://...';
		process.env.CASCADE_CREDENTIALS = 'creds';
		process.env.CASCADE_CREDENTIALS_PROJECT_ID = 'proj-id';

		scrubSensitiveEnv();

		expect(process.env.CREDENTIAL_MASTER_KEY).toBeUndefined();
		expect(process.env.DATABASE_URL).toBeUndefined();
		expect(process.env.DATABASE_SSL).toBeUndefined();
		expect(process.env.REDIS_URL).toBeUndefined();
		expect(process.env.CASCADE_CREDENTIALS).toBeUndefined();
		expect(process.env.CASCADE_CREDENTIALS_PROJECT_ID).toBeUndefined();
	});

	it('does not remove non-sensitive environment variables', () => {
		process.env.MY_APP_API_KEY = 'should-remain';
		process.env.PORT = '3000';

		scrubSensitiveEnv();

		expect(process.env.MY_APP_API_KEY).toBe('should-remain');
		expect(process.env.PORT).toBe('3000');

		// Clean up test-specific vars
		process.env.MY_APP_API_KEY = undefined;
		process.env.PORT = undefined;
	});

	it('handles keys that were never set (undefined)', () => {
		// Ensure they are undefined to start
		process.env.CREDENTIAL_MASTER_KEY = undefined;
		process.env.DATABASE_URL = undefined;

		// Should not throw
		expect(() => scrubSensitiveEnv()).not.toThrow();

		expect(process.env.CREDENTIAL_MASTER_KEY).toBeUndefined();
		expect(process.env.DATABASE_URL).toBeUndefined();
	});

	it('scrubbing is idempotent — calling twice does not throw', () => {
		process.env.DATABASE_URL = 'postgres://...';
		scrubSensitiveEnv();
		expect(() => scrubSensitiveEnv()).not.toThrow();
	});
});

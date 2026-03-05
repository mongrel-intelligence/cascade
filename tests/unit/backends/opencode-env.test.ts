import { describe, expect, it } from 'vitest';
import {
	ALLOWED_ENV_EXACT,
	ALLOWED_ENV_PREFIXES,
	BLOCKED_ENV_EXACT,
	buildOpencodeEnv,
} from '../../../src/backends/opencode/env.js';

describe('buildOpencodeEnv', () => {
	it('passes through exact-match allowed vars from process.env', () => {
		// We test using projectSecrets to simulate values we expect to pass through.
		// HOME, PATH, etc. come from process.env — test that they appear in the result.
		const { env } = buildOpencodeEnv();
		// HOME and PATH should be present (from real process.env in test runner)
		expect(env.HOME).toBeDefined();
		expect(env.PATH).toBeDefined();
	});

	it('includes ANTHROPIC_API_KEY when provided via projectSecrets', () => {
		const { env } = buildOpencodeEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' });
		expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
	});

	it('includes OPENROUTER_API_KEY when provided via projectSecrets', () => {
		const { env } = buildOpencodeEnv({ OPENROUTER_API_KEY: 'sk-or-test' });
		expect(env.OPENROUTER_API_KEY).toBe('sk-or-test');
	});

	it('includes OPENCODE_CONFIG_CONTENT when provided via projectSecrets', () => {
		const config = JSON.stringify({ theme: 'dark' });
		const { env } = buildOpencodeEnv({ OPENCODE_CONFIG_CONTENT: config });
		expect(env.OPENCODE_CONFIG_CONTENT).toBe(config);
	});

	it('projectSecrets are merged on top of filtered process.env', () => {
		const { env } = buildOpencodeEnv({
			GITHUB_TOKEN: 'ghp_test',
			TRELLO_TOKEN: 'trello-test',
		});
		expect(env.GITHUB_TOKEN).toBe('ghp_test');
		expect(env.TRELLO_TOKEN).toBe('trello-test');
	});

	it('does not include DATABASE_URL in env', () => {
		// DATABASE_URL would come from process.env — verify it's blocked
		const { env } = buildOpencodeEnv();
		expect(env.DATABASE_URL).toBeUndefined();
	});

	it('does not include REDIS_URL in env', () => {
		const { env } = buildOpencodeEnv();
		expect(env.REDIS_URL).toBeUndefined();
	});

	it('does not include NODE_OPTIONS in env', () => {
		const { env } = buildOpencodeEnv();
		expect(env.NODE_OPTIONS).toBeUndefined();
	});

	it('returns an object with an env key', () => {
		const result = buildOpencodeEnv();
		expect(result).toHaveProperty('env');
		expect(typeof result.env).toBe('object');
	});

	it('works with no arguments', () => {
		expect(() => buildOpencodeEnv()).not.toThrow();
	});

	it('works with empty projectSecrets', () => {
		const { env } = buildOpencodeEnv({});
		expect(env).toBeDefined();
	});
});

describe('allowlist constants', () => {
	it('ALLOWED_ENV_EXACT includes HOME and PATH', () => {
		expect(ALLOWED_ENV_EXACT.has('HOME')).toBe(true);
		expect(ALLOWED_ENV_EXACT.has('PATH')).toBe(true);
	});

	it('ALLOWED_ENV_EXACT includes ANTHROPIC_API_KEY', () => {
		expect(ALLOWED_ENV_EXACT.has('ANTHROPIC_API_KEY')).toBe(true);
	});

	it('ALLOWED_ENV_EXACT includes OPENROUTER_API_KEY', () => {
		expect(ALLOWED_ENV_EXACT.has('OPENROUTER_API_KEY')).toBe(true);
	});

	it('ALLOWED_ENV_EXACT includes OPENCODE_CONFIG_CONTENT', () => {
		expect(ALLOWED_ENV_EXACT.has('OPENCODE_CONFIG_CONTENT')).toBe(true);
	});

	it('ALLOWED_ENV_EXACT does not overlap with BLOCKED_ENV_EXACT', () => {
		for (const key of BLOCKED_ENV_EXACT) {
			expect(ALLOWED_ENV_EXACT.has(key)).toBe(false);
		}
	});

	it('BLOCKED_ENV_EXACT includes DATABASE_URL and REDIS_URL', () => {
		expect(BLOCKED_ENV_EXACT.has('DATABASE_URL')).toBe(true);
		expect(BLOCKED_ENV_EXACT.has('REDIS_URL')).toBe(true);
	});

	it('BLOCKED_ENV_EXACT includes NODE_OPTIONS', () => {
		expect(BLOCKED_ENV_EXACT.has('NODE_OPTIONS')).toBe(true);
	});

	it('ALLOWED_ENV_PREFIXES are all uppercase with trailing underscore', () => {
		for (const prefix of ALLOWED_ENV_PREFIXES) {
			expect(prefix).toMatch(/^[A-Z_]+_$/);
		}
	});

	it('ALLOWED_ENV_PREFIXES includes GIT_ and SSH_', () => {
		expect(ALLOWED_ENV_PREFIXES).toContain('GIT_');
		expect(ALLOWED_ENV_PREFIXES).toContain('SSH_');
	});
});

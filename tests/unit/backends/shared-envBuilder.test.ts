import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildEngineEnv } from '../../../src/backends/shared/envBuilder.js';
import {
	SHARED_ALLOWED_ENV_EXACT,
	SHARED_BLOCKED_ENV_EXACT,
} from '../../../src/backends/shared/envFilter.js';

// We test buildEngineEnv by controlling process.env
const CLEAN_ENV: Record<string, string> = {
	HOME: '/home/user',
	PATH: '/usr/bin:/usr/local/bin',
	SHELL: '/bin/bash',
	USER: 'testuser',
	GIT_AUTHOR_NAME: 'Test User',
	// Should be blocked
	DATABASE_URL: 'postgres://user:pass@host:5432/db',
	REDIS_URL: 'redis://localhost:6379',
	MY_SECRET: 'should-not-appear',
};

describe('buildEngineEnv', () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = process.env;
		process.env = { ...CLEAN_ENV } as NodeJS.ProcessEnv;
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('filters process.env through the shared allowlist', () => {
		const env = buildEngineEnv({ allowedEnvExact: new Set() });

		expect(env.HOME).toBe('/home/user');
		expect(env.PATH).toBe('/usr/bin:/usr/local/bin');
		expect(env.SHELL).toBe('/bin/bash');
		expect(env.GIT_AUTHOR_NAME).toBe('Test User');
	});

	it('blocks server-side secrets even without extra allowlist entries', () => {
		const env = buildEngineEnv({ allowedEnvExact: new Set() });

		expect(env.DATABASE_URL).toBeUndefined();
		expect(env.REDIS_URL).toBeUndefined();
		expect(env.MY_SECRET).toBeUndefined();
	});

	it('passes through engine-specific vars added to allowedEnvExact', () => {
		process.env.OPENAI_API_KEY = 'sk-test-openai';
		const env = buildEngineEnv({
			allowedEnvExact: new Set(['OPENAI_API_KEY']),
		});

		expect(env.OPENAI_API_KEY).toBe('sk-test-openai');
	});

	it('spreads projectSecrets on top of filtered env', () => {
		const env = buildEngineEnv({
			allowedEnvExact: new Set(),
			projectSecrets: { GITHUB_TOKEN_IMPLEMENTER: 'ghp_secret', OPENAI_API_KEY: 'sk-from-db' },
		});

		// Project secrets pass through regardless of allowlist
		expect(env.GITHUB_TOKEN_IMPLEMENTER).toBe('ghp_secret');
		expect(env.OPENAI_API_KEY).toBe('sk-from-db');
	});

	it('spreads extraVars on top of filtered env and projectSecrets', () => {
		const env = buildEngineEnv({
			allowedEnvExact: new Set(),
			extraVars: { CI: 'true', CODEX_DISABLE_UPDATE_NOTIFIER: '1' },
		});

		expect(env.CI).toBe('true');
		expect(env.CODEX_DISABLE_UPDATE_NOTIFIER).toBe('1');
	});

	it('extraVars override projectSecrets which override filtered env', () => {
		process.env.HOME = '/filtered-home';
		const env = buildEngineEnv({
			allowedEnvExact: new Set(),
			projectSecrets: { HOME: '/project-home' },
			extraVars: { HOME: '/extra-home' },
		});

		expect(env.HOME).toBe('/extra-home');
	});

	it('prepends cliToolsDir to PATH when provided', () => {
		const env = buildEngineEnv({
			allowedEnvExact: new Set(),
			cliToolsDir: '/usr/local/cascade-tools',
		});

		expect(env.PATH).toContain('/usr/local/cascade-tools');
		// cliToolsDir should appear before the original PATH
		expect(env.PATH?.startsWith('/usr/local/cascade-tools')).toBe(true);
	});

	it('prepends nativeToolShimDir before cliToolsDir in PATH', () => {
		const env = buildEngineEnv({
			allowedEnvExact: new Set(),
			cliToolsDir: '/usr/local/cascade-tools',
			nativeToolShimDir: '/tmp/shims',
		});

		const parts = env.PATH?.split(':') ?? [];
		const shimIdx = parts.indexOf('/tmp/shims');
		const cliIdx = parts.indexOf('/usr/local/cascade-tools');
		expect(shimIdx).toBeGreaterThanOrEqual(0);
		expect(cliIdx).toBeGreaterThanOrEqual(0);
		expect(shimIdx).toBeLessThan(cliIdx);
	});

	it('does not modify PATH when cliToolsDir is undefined', () => {
		const env = buildEngineEnv({ allowedEnvExact: new Set() });

		expect(env.PATH).toBe('/usr/bin:/usr/local/bin');
	});

	it('handles undefined projectSecrets gracefully', () => {
		const env = buildEngineEnv({ allowedEnvExact: new Set(), projectSecrets: undefined });

		// Should not throw; basic vars should still be present
		expect(env.HOME).toBe('/home/user');
	});

	it('handles undefined extraVars gracefully', () => {
		const env = buildEngineEnv({ allowedEnvExact: new Set(), extraVars: undefined });

		expect(env.HOME).toBe('/home/user');
	});

	describe('claude-code config', () => {
		it('includes CLAUDE_CODE_OAUTH_TOKEN when in allowedEnvExact', () => {
			process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test';

			const env = buildEngineEnv({
				allowedEnvExact: new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']),
				extraVars: { CLAUDE_AGENT_SDK_CLIENT_APP: 'cascade/1.0.0' },
			});

			expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-test');
			expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('cascade/1.0.0');
		});

		it('does not leak OPENROUTER_API_KEY when not in claude-code allowlist', () => {
			process.env.OPENROUTER_API_KEY = 'or-key';

			const env = buildEngineEnv({
				allowedEnvExact: new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']),
			});

			expect(env.OPENROUTER_API_KEY).toBeUndefined();
		});
	});

	describe('codex config', () => {
		it('injects CI and CODEX_DISABLE_UPDATE_NOTIFIER', () => {
			const env = buildEngineEnv({
				allowedEnvExact: new Set(['OPENAI_API_KEY']),
				extraVars: { CI: 'true', CODEX_DISABLE_UPDATE_NOTIFIER: '1' },
			});

			expect(env.CI).toBe('true');
			expect(env.CODEX_DISABLE_UPDATE_NOTIFIER).toBe('1');
		});

		it('does not leak ANTHROPIC_API_KEY when not in codex allowlist', () => {
			process.env.ANTHROPIC_API_KEY = 'sk-ant';

			const env = buildEngineEnv({
				allowedEnvExact: new Set(['OPENAI_API_KEY']),
				extraVars: { CI: 'true', CODEX_DISABLE_UPDATE_NOTIFIER: '1' },
			});

			expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		});
	});

	describe('opencode config', () => {
		it('injects CI and allows OPENROUTER_API_KEY', () => {
			process.env.OPENROUTER_API_KEY = 'or-key';

			const env = buildEngineEnv({
				allowedEnvExact: new Set(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY']),
				extraVars: { CI: 'true' },
			});

			expect(env.CI).toBe('true');
			expect(env.OPENROUTER_API_KEY).toBe('or-key');
		});
	});

	describe('security invariants', () => {
		it('always blocks all SHARED_BLOCKED_ENV_EXACT vars regardless of allowedEnvExact', () => {
			// Even if someone accidentally adds a blocked key to the engine allowlist,
			// blocked vars must still be excluded from the filtered env (they can still
			// appear via projectSecrets/extraVars overrides, which is intentional).
			for (const blockedKey of SHARED_BLOCKED_ENV_EXACT) {
				process.env[blockedKey] = 'dangerous-value';
			}

			const env = buildEngineEnv({
				// Attempt to add all blocked keys to the allowlist
				allowedEnvExact: new Set([...SHARED_BLOCKED_ENV_EXACT]),
			});

			// All blocked vars should still be absent from the env (filterProcessEnv
			// gives blocklist priority over allowlist)
			for (const blockedKey of SHARED_BLOCKED_ENV_EXACT) {
				expect(env[blockedKey]).toBeUndefined();
			}
		});

		it('allowedEnvExact does not overlap with SHARED_BLOCKED_ENV_EXACT in typical engine configs', () => {
			// Verify that the SHARED_ALLOWED_ENV_EXACT (the base used by engines) has
			// no overlap with SHARED_BLOCKED_ENV_EXACT
			for (const key of SHARED_BLOCKED_ENV_EXACT) {
				expect(SHARED_ALLOWED_ENV_EXACT.has(key)).toBe(false);
			}
		});
	});
});

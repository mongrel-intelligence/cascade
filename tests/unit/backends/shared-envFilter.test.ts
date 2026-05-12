import { describe, expect, it } from 'vitest';
import { GITHUB_ACK_COMMENT_ID_ENV_VAR } from '../../../src/backends/secretBuilder.js';
import {
	filterProcessEnv,
	SHARED_ALLOWED_ENV_EXACT,
	SHARED_ALLOWED_ENV_PREFIXES,
	SHARED_BLOCKED_ENV_EXACT,
} from '../../../src/backends/shared/envFilter.js';
import {
	FRICTION_SIDECAR_ENV_VAR,
	PM_WRITE_SIDECAR_ENV_VAR,
	PR_SIDECAR_ENV_VAR,
	PUSHED_CHANGES_SIDECAR_ENV_VAR,
	REVIEW_SIDECAR_ENV_VAR,
} from '../../../src/gadgets/sessionState.js';

describe('filterProcessEnv (shared)', () => {
	it('passes through exact-match shared allowed vars', () => {
		const input: Record<string, string> = {
			HOME: '/home/user',
			PATH: '/usr/bin',
			SHELL: '/bin/bash',
			TERM: 'xterm-256color',
			USER: 'testuser',
			LANG: 'en_US.UTF-8',
			NODE_PATH: '/usr/lib/node',
			EDITOR: 'vim',
		};

		const result = filterProcessEnv(input);

		for (const [key, value] of Object.entries(input)) {
			expect(result[key]).toBe(value);
		}
	});

	it('passes through prefix-matched vars', () => {
		const input: Record<string, string> = {
			LC_ALL: 'en_US.UTF-8',
			LC_CTYPE: 'UTF-8',
			XDG_CONFIG_HOME: '/home/user/.config',
			GIT_AUTHOR_NAME: 'Test User',
			GIT_COMMITTER_EMAIL: 'test@example.com',
			SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
			SSH_AGENT_PID: '12345',
			GPG_TTY: '/dev/pts/0',
			DOCKER_HOST: 'unix:///var/run/docker.sock',
		};

		const result = filterProcessEnv(input);

		for (const [key, value] of Object.entries(input)) {
			expect(result[key]).toBe(value);
		}
	});

	it('blocks all SHARED_BLOCKED_ENV_EXACT vars by default', () => {
		const input: Record<string, string> = {};
		for (const key of SHARED_BLOCKED_ENV_EXACT) {
			input[key] = 'some-value';
		}

		const result = filterProcessEnv(input);

		for (const key of SHARED_BLOCKED_ENV_EXACT) {
			expect(result[key]).toBeUndefined();
		}
	});

	it('blocks DATABASE_URL specifically', () => {
		const result = filterProcessEnv({ DATABASE_URL: 'postgres://user:pass@host:5432/db' });
		expect(result.DATABASE_URL).toBeUndefined();
	});

	it('blocks REDIS_URL specifically', () => {
		const result = filterProcessEnv({ REDIS_URL: 'redis://localhost:6379' });
		expect(result.REDIS_URL).toBeUndefined();
	});

	it('blocks NODE_OPTIONS and VSCODE_INSPECTOR_OPTIONS', () => {
		const result = filterProcessEnv({
			NODE_OPTIONS: '--inspect=9229',
			VSCODE_INSPECTOR_OPTIONS: '{"some":"config"}',
		});
		expect(result.NODE_OPTIONS).toBeUndefined();
		expect(result.VSCODE_INSPECTOR_OPTIONS).toBeUndefined();
	});

	it('drops unknown vars not in any allowlist', () => {
		const result = filterProcessEnv({
			MY_CUSTOM_SECRET: 'secret',
			TRELLO_TOKEN: 'token123',
			AWS_SECRET_ACCESS_KEY: 'aws-secret',
			STRIPE_SECRET_KEY: 'sk_live_123',
		});

		expect(result.MY_CUSTOM_SECRET).toBeUndefined();
		expect(result.TRELLO_TOKEN).toBeUndefined();
		expect(result.AWS_SECRET_ACCESS_KEY).toBeUndefined();
		expect(result.STRIPE_SECRET_KEY).toBeUndefined();
	});

	it('skips entries with undefined values', () => {
		const result = filterProcessEnv({
			HOME: undefined as unknown as string,
			PATH: '/usr/bin',
		});

		expect(result.HOME).toBeUndefined();
		expect(result.PATH).toBe('/usr/bin');
	});

	it('returns empty object for empty input', () => {
		expect(filterProcessEnv({})).toEqual({});
	});

	it('blocked vars take precedence over allowed prefixes', () => {
		const result = filterProcessEnv({
			DATABASE_URL: 'postgres://localhost',
			DATABASE_SSL: 'false',
		});
		expect(result.DATABASE_URL).toBeUndefined();
		expect(result.DATABASE_SSL).toBeUndefined();
	});

	it('combines exact + prefix matches correctly', () => {
		const result = filterProcessEnv({
			HOME: '/home/user',
			PATH: '/usr/bin',
			LC_ALL: 'C',
			GIT_DIR: '/repo/.git',
			DATABASE_URL: 'postgres://host/db',
			MY_SECRET: 'hidden',
		});

		expect(Object.keys(result).sort()).toEqual(['GIT_DIR', 'HOME', 'LC_ALL', 'PATH']);
	});

	it('accepts custom allowedEnvExact to include engine-specific vars', () => {
		const customAllowed = new Set([...SHARED_ALLOWED_ENV_EXACT, 'OPENAI_API_KEY']);
		const result = filterProcessEnv(
			{ HOME: '/home/user', OPENAI_API_KEY: 'sk-test', MY_SECRET: 'hidden' },
			customAllowed,
		);

		expect(result.HOME).toBe('/home/user');
		expect(result.OPENAI_API_KEY).toBe('sk-test');
		expect(result.MY_SECRET).toBeUndefined();
	});

	it('accepts custom blockedEnvExact to block additional vars', () => {
		const customBlocked = new Set([...SHARED_BLOCKED_ENV_EXACT, 'HOME']);
		const result = filterProcessEnv(
			{ HOME: '/home/user', PATH: '/usr/bin' },
			undefined,
			undefined,
			customBlocked,
		);

		expect(result.HOME).toBeUndefined();
		expect(result.PATH).toBe('/usr/bin');
	});
});

describe('SHARED_ALLOWED_ENV_EXACT', () => {
	it('does not overlap with SHARED_BLOCKED_ENV_EXACT', () => {
		for (const key of SHARED_BLOCKED_ENV_EXACT) {
			expect(SHARED_ALLOWED_ENV_EXACT.has(key)).toBe(false);
		}
	});

	it('includes CASCADE_GITHUB_ACK_COMMENT_ID', () => {
		expect(SHARED_ALLOWED_ENV_EXACT.has(GITHUB_ACK_COMMENT_ID_ENV_VAR)).toBe(true);
	});

	it('passes CASCADE_GITHUB_ACK_COMMENT_ID through filterProcessEnv', () => {
		const result = filterProcessEnv({ [GITHUB_ACK_COMMENT_ID_ENV_VAR]: '12345' });
		expect(result[GITHUB_ACK_COMMENT_ID_ENV_VAR]).toBe('12345');
	});

	// Regression net for prod incidents MNG-741 / MNG-736 / MNG-739 (2026-05-12):
	// `sidecarManager` injected `CASCADE_PM_WRITE_SIDECAR_PATH` into projectSecrets
	// but the allowlist here dropped it on the way to the subprocess, so the
	// agent's `cascade-tools pm add-checklist` call never wrote the sidecar and
	// every planning run failed the `requiresPMWrite` gate. Same drift hazard
	// for any future sidecar env var. This block iterates every sidecar constant
	// defined in `src/gadgets/sessionState.ts` and asserts each is allowlisted
	// AND survives `filterProcessEnv` round-trip — so a new sidecar can't ship
	// without its env var being plumbed end-to-end.
	describe('sidecar env-var allowlist invariant (MNG-741 regression)', () => {
		const sidecarEnvVars = [
			{ name: 'PM_WRITE_SIDECAR_ENV_VAR', value: PM_WRITE_SIDECAR_ENV_VAR },
			{ name: 'PR_SIDECAR_ENV_VAR', value: PR_SIDECAR_ENV_VAR },
			{ name: 'PUSHED_CHANGES_SIDECAR_ENV_VAR', value: PUSHED_CHANGES_SIDECAR_ENV_VAR },
			{ name: 'REVIEW_SIDECAR_ENV_VAR', value: REVIEW_SIDECAR_ENV_VAR },
			{ name: 'FRICTION_SIDECAR_ENV_VAR', value: FRICTION_SIDECAR_ENV_VAR },
		] as const;

		for (const { name, value } of sidecarEnvVars) {
			it(`${name} (${value}) is in SHARED_ALLOWED_ENV_EXACT`, () => {
				expect(SHARED_ALLOWED_ENV_EXACT.has(value)).toBe(true);
			});

			it(`${name} survives filterProcessEnv round-trip`, () => {
				const result = filterProcessEnv({ [value]: '/tmp/sidecar-xyz.json' });
				expect(result[value]).toBe('/tmp/sidecar-xyz.json');
			});
		}
	});
});

describe('SHARED_ALLOWED_ENV_PREFIXES', () => {
	it('are all uppercase with trailing underscore', () => {
		for (const prefix of SHARED_ALLOWED_ENV_PREFIXES) {
			expect(prefix).toMatch(/^[A-Z_]+_$/);
		}
	});

	it('includes LC_, XDG_, GIT_, SSH_, GPG_, DOCKER_', () => {
		const prefixes = [...SHARED_ALLOWED_ENV_PREFIXES];
		expect(prefixes).toContain('LC_');
		expect(prefixes).toContain('XDG_');
		expect(prefixes).toContain('GIT_');
		expect(prefixes).toContain('SSH_');
		expect(prefixes).toContain('GPG_');
		expect(prefixes).toContain('DOCKER_');
	});
});

describe('SHARED_BLOCKED_ENV_EXACT', () => {
	it('contains critical server-side secrets', () => {
		expect(SHARED_BLOCKED_ENV_EXACT.has('DATABASE_URL')).toBe(true);
		expect(SHARED_BLOCKED_ENV_EXACT.has('REDIS_URL')).toBe(true);
		expect(SHARED_BLOCKED_ENV_EXACT.has('CREDENTIAL_MASTER_KEY')).toBe(true);
		expect(SHARED_BLOCKED_ENV_EXACT.has('NODE_OPTIONS')).toBe(true);
	});
});

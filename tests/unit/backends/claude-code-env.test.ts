import { describe, expect, it } from 'vitest';
import {
	ALLOWED_ENV_EXACT,
	ALLOWED_ENV_PREFIXES,
	BLOCKED_ENV_EXACT,
	filterProcessEnv,
} from '../../../src/backends/claude-code/env.js';
import { GITHUB_ACK_COMMENT_ID_ENV_VAR } from '../../../src/backends/secretBuilder.js';

describe('filterProcessEnv', () => {
	it('passes through exact-match allowed vars', () => {
		const input: Record<string, string> = {
			HOME: '/home/user',
			PATH: '/usr/bin',
			SHELL: '/bin/bash',
			TERM: 'xterm-256color',
			USER: 'testuser',
			LANG: 'en_US.UTF-8',
			CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test',
			ANTHROPIC_API_KEY: 'sk-ant-test',
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

	it('blocks all BLOCKED_ENV_EXACT vars', () => {
		const input: Record<string, string> = {};
		for (const key of BLOCKED_ENV_EXACT) {
			input[key] = 'some-value';
		}

		const result = filterProcessEnv(input);

		for (const key of BLOCKED_ENV_EXACT) {
			expect(result[key]).toBeUndefined();
		}
	});

	it('blocks DATABASE_URL specifically', () => {
		const result = filterProcessEnv({
			DATABASE_URL: 'postgres://user:pass@host:5432/db',
		});
		expect(result.DATABASE_URL).toBeUndefined();
	});

	it('blocks REDIS_URL specifically', () => {
		const result = filterProcessEnv({
			REDIS_URL: 'redis://localhost:6379',
		});
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
			OPENROUTER_API_KEY: 'key123',
			TRELLO_TOKEN: 'token123',
			AWS_SECRET_ACCESS_KEY: 'aws-secret',
			STRIPE_SECRET_KEY: 'sk_live_123',
		});

		expect(result.MY_CUSTOM_SECRET).toBeUndefined();
		expect(result.OPENROUTER_API_KEY).toBeUndefined();
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
		// DATABASE_SSL could hypothetically match a future prefix — ensure block wins
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
});

describe('allowlist constants', () => {
	it('ALLOWED_ENV_EXACT does not overlap with BLOCKED_ENV_EXACT', () => {
		for (const key of BLOCKED_ENV_EXACT) {
			expect(ALLOWED_ENV_EXACT.has(key)).toBe(false);
		}
	});

	it('ALLOWED_ENV_PREFIXES are all uppercase with trailing underscore', () => {
		for (const prefix of ALLOWED_ENV_PREFIXES) {
			expect(prefix).toMatch(/^[A-Z_]+_$/);
		}
	});

	it('CASCADE_GITHUB_ACK_COMMENT_ID is in the allowlist', () => {
		expect(ALLOWED_ENV_EXACT.has(GITHUB_ACK_COMMENT_ID_ENV_VAR)).toBe(true);
	});

	it('CASCADE_GITHUB_ACK_COMMENT_ID passes through filterProcessEnv', () => {
		const result = filterProcessEnv({
			[GITHUB_ACK_COMMENT_ID_ENV_VAR]: '12345',
		});
		expect(result[GITHUB_ACK_COMMENT_ID_ENV_VAR]).toBe('12345');
	});
});

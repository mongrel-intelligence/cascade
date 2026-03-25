/**
 * Unit tests for OpenCode permission mapping helpers.
 *
 * Covers buildPermissionConfig, normalizePermissionDecision, and
 * resolvePermissionDecision in isolation — no SDK stream orchestration.
 */

import { describe, expect, it } from 'vitest';

import {
	buildPermissionConfig,
	normalizePermissionDecision,
	resolvePermissionDecision,
} from '../../../src/backends/opencode/permissions.js';

describe('buildPermissionConfig', () => {
	it('denies edit, bash, webfetch, external_directory, and doom_loop by default (no capabilities)', () => {
		expect(buildPermissionConfig(undefined, false)).toEqual({
			edit: 'deny',
			bash: 'deny',
			webfetch: 'deny',
			doom_loop: 'deny',
			external_directory: 'deny',
		});
	});

	it('denies edit when fs:write capability is absent', () => {
		const config = buildPermissionConfig(['fs:read'], false);
		expect(config.edit).toBe('deny');
	});

	it('allows edit when fs:write capability is present', () => {
		const config = buildPermissionConfig(['fs:write'], false);
		expect(config.edit).toBe('allow');
	});

	it('denies bash when shell:exec capability is absent', () => {
		const config = buildPermissionConfig(['fs:read', 'fs:write'], false);
		expect(config.bash).toBe('deny');
	});

	it('allows bash when shell:exec capability is present', () => {
		const config = buildPermissionConfig(['shell:exec'], false);
		expect(config.bash).toBe('allow');
	});

	it('denies webfetch when webSearch is false', () => {
		const config = buildPermissionConfig(['fs:write', 'shell:exec'], false);
		expect(config.webfetch).toBe('deny');
	});

	it('allows webfetch when webSearch is true', () => {
		const config = buildPermissionConfig([], true);
		expect(config.webfetch).toBe('allow');
	});

	it('always denies doom_loop regardless of capabilities', () => {
		expect(buildPermissionConfig(['fs:write', 'shell:exec'], true).doom_loop).toBe('deny');
		expect(buildPermissionConfig(undefined, false).doom_loop).toBe('deny');
	});

	it('always denies external_directory regardless of capabilities', () => {
		expect(buildPermissionConfig(['fs:write', 'shell:exec'], true).external_directory).toBe('deny');
		expect(buildPermissionConfig(undefined, false).external_directory).toBe('deny');
	});

	it('allows edit, bash, and webfetch together when all capabilities are present', () => {
		expect(buildPermissionConfig(['fs:write', 'shell:exec'], true)).toEqual({
			edit: 'allow',
			bash: 'allow',
			webfetch: 'allow',
			doom_loop: 'deny',
			external_directory: 'deny',
		});
	});

	it('denies edit, bash, and webfetch when only fs:read is provided and webSearch is false', () => {
		expect(buildPermissionConfig(['fs:read'], false)).toEqual({
			edit: 'deny',
			bash: 'deny',
			webfetch: 'deny',
			doom_loop: 'deny',
			external_directory: 'deny',
		});
	});

	it('treats an empty capabilities array the same as undefined for write/exec', () => {
		const withEmpty = buildPermissionConfig([], false);
		const withUndefined = buildPermissionConfig(undefined, false);
		expect(withEmpty).toEqual(withUndefined);
	});
});

describe('normalizePermissionDecision', () => {
	it('maps "allow" to "always"', () => {
		expect(normalizePermissionDecision('allow')).toBe('always');
	});

	it('maps "deny" to "reject"', () => {
		expect(normalizePermissionDecision('deny')).toBe('reject');
	});
});

describe('resolvePermissionDecision', () => {
	const allowAll = {
		edit: 'allow' as const,
		bash: 'allow' as const,
		webfetch: 'allow' as const,
		external_directory: 'allow' as const,
		doom_loop: 'allow' as const,
	};

	const denyAll = {
		edit: 'deny' as const,
		bash: 'deny' as const,
		webfetch: 'deny' as const,
		external_directory: 'deny' as const,
		doom_loop: 'deny' as const,
	};

	describe('edit permission type', () => {
		it('returns allow when config.edit is "allow"', () => {
			expect(resolvePermissionDecision({ type: 'edit' }, allowAll)).toBe('allow');
		});

		it('returns deny when config.edit is "deny"', () => {
			expect(resolvePermissionDecision({ type: 'edit' }, denyAll)).toBe('deny');
		});
	});

	describe('bash permission type', () => {
		it('returns allow when config.bash is "allow"', () => {
			expect(resolvePermissionDecision({ type: 'bash' }, allowAll)).toBe('allow');
		});

		it('returns deny when config.bash is "deny"', () => {
			expect(resolvePermissionDecision({ type: 'bash' }, denyAll)).toBe('deny');
		});
	});

	describe('webfetch permission type', () => {
		it('returns allow when config.webfetch is "allow"', () => {
			expect(resolvePermissionDecision({ type: 'webfetch' }, allowAll)).toBe('allow');
		});

		it('returns deny when config.webfetch is "deny"', () => {
			expect(resolvePermissionDecision({ type: 'webfetch' }, denyAll)).toBe('deny');
		});
	});

	describe('external_directory permission type', () => {
		it('returns allow when config.external_directory is "allow"', () => {
			expect(resolvePermissionDecision({ type: 'external_directory' }, allowAll)).toBe('allow');
		});

		it('returns deny when config.external_directory is "deny"', () => {
			expect(resolvePermissionDecision({ type: 'external_directory' }, denyAll)).toBe('deny');
		});
	});

	describe('doom_loop permission type', () => {
		it('returns allow when config.doom_loop is "allow"', () => {
			expect(resolvePermissionDecision({ type: 'doom_loop' }, allowAll)).toBe('allow');
		});

		it('returns deny when config.doom_loop is "deny"', () => {
			expect(resolvePermissionDecision({ type: 'doom_loop' }, denyAll)).toBe('deny');
		});
	});

	describe('unknown permission types', () => {
		it('resolves to deny for an unrecognized permission type', () => {
			expect(resolvePermissionDecision({ type: 'unknown_tool' as never }, denyAll)).toBe('deny');
		});

		it('resolves to deny for another unknown type even with an allow-all config', () => {
			expect(resolvePermissionDecision({ type: 'write' as never }, allowAll)).toBe('deny');
		});

		it('resolves to deny for an empty-string type', () => {
			expect(resolvePermissionDecision({ type: '' as never }, allowAll)).toBe('deny');
		});
	});

	describe('integration: buildPermissionConfig → resolvePermissionDecision', () => {
		it('denies edit when built config has no fs:write', () => {
			const config = buildPermissionConfig(['fs:read'], false);
			expect(resolvePermissionDecision({ type: 'edit' }, config)).toBe('deny');
		});

		it('allows edit when built config has fs:write', () => {
			const config = buildPermissionConfig(['fs:write'], false);
			expect(resolvePermissionDecision({ type: 'edit' }, config)).toBe('allow');
		});

		it('denies bash when built config has no shell:exec', () => {
			const config = buildPermissionConfig(['fs:read', 'fs:write'], false);
			expect(resolvePermissionDecision({ type: 'bash' }, config)).toBe('deny');
		});

		it('allows bash when built config has shell:exec', () => {
			const config = buildPermissionConfig(['shell:exec'], false);
			expect(resolvePermissionDecision({ type: 'bash' }, config)).toBe('allow');
		});

		it('denies webfetch when webSearch is false in built config', () => {
			const config = buildPermissionConfig(['fs:write', 'shell:exec'], false);
			expect(resolvePermissionDecision({ type: 'webfetch' }, config)).toBe('deny');
		});

		it('allows webfetch when webSearch is true in built config', () => {
			const config = buildPermissionConfig(['fs:write', 'shell:exec'], true);
			expect(resolvePermissionDecision({ type: 'webfetch' }, config)).toBe('allow');
		});

		it('always denies doom_loop from built config', () => {
			const config = buildPermissionConfig(['fs:write', 'shell:exec'], true);
			expect(resolvePermissionDecision({ type: 'doom_loop' }, config)).toBe('deny');
		});

		it('always denies external_directory from built config', () => {
			const config = buildPermissionConfig(['fs:write', 'shell:exec'], true);
			expect(resolvePermissionDecision({ type: 'external_directory' }, config)).toBe('deny');
		});
	});
});

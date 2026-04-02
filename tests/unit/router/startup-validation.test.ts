import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateCredentialMasterKey } from '../../../src/db/crypto.js';

/**
 * Tests for startup validation behavior in router and dashboard.
 *
 * Both startRouter() and startDashboard() call validateCredentialMasterKey()
 * and process.exit(1) if the key is malformed. Since both modules auto-execute
 * at import time, we test the startup validation logic by verifying the
 * validateCredentialMasterKey() + process.exit integration directly.
 *
 * This simulates the pattern used in both entry points:
 *   const keyValidation = validateCredentialMasterKey();
 *   if (!keyValidation.valid) {
 *     <log error>;
 *     process.exit(1);
 *   }
 */

// Generate a valid 32-byte hex key for tests
const TEST_KEY = randomBytes(32).toString('hex');

describe('startup validation logic (router + dashboard pattern)', () => {
	let processExitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		processExitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
			throw new Error(`process.exit(${_code})`);
		});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		processExitSpy.mockRestore();
	});

	/**
	 * Simulates the startup validation block used in startRouter() and startDashboard().
	 */
	function runStartupValidation(): void {
		const keyValidation = validateCredentialMasterKey();
		if (!keyValidation.valid) {
			process.exit(1);
		}
	}

	describe('when CREDENTIAL_MASTER_KEY is invalid', () => {
		it('calls process.exit(1) for a too-short key', () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'tooshort');

			expect(() => runStartupValidation()).toThrow('process.exit(1)');
			expect(processExitSpy).toHaveBeenCalledWith(1);
		});

		it('calls process.exit(1) for a key with non-hex characters', () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'g'.repeat(64));

			expect(() => runStartupValidation()).toThrow('process.exit(1)');
			expect(processExitSpy).toHaveBeenCalledWith(1);
		});

		it('calls process.exit(1) for a key that is too long', () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'a'.repeat(128));

			expect(() => runStartupValidation()).toThrow('process.exit(1)');
			expect(processExitSpy).toHaveBeenCalledWith(1);
		});
	});

	describe('when CREDENTIAL_MASTER_KEY is valid or unset', () => {
		it('does NOT call process.exit when key is unset', () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', '');

			expect(() => runStartupValidation()).not.toThrow();
			expect(processExitSpy).not.toHaveBeenCalled();
		});

		it('does NOT call process.exit when key is a valid 64-char hex string', () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', TEST_KEY);

			expect(() => runStartupValidation()).not.toThrow();
			expect(processExitSpy).not.toHaveBeenCalled();
		});
	});
});

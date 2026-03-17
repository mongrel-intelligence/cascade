import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	decryptCredential,
	encryptCredential,
	isEncryptedValue,
	isEncryptionEnabled,
	reEncryptCredential,
} from '../../../src/db/crypto.js';

// Generate a valid 32-byte hex key for tests
const TEST_KEY = randomBytes(32).toString('hex');

describe('crypto', () => {
	beforeEach(() => {
		vi.stubEnv('CREDENTIAL_MASTER_KEY', TEST_KEY);
	});

	describe('isEncryptionEnabled', () => {
		it('returns true when CREDENTIAL_MASTER_KEY is set', () => {
			expect(isEncryptionEnabled()).toBe(true);
		});

		it('returns false when CREDENTIAL_MASTER_KEY is not set', () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', '');
			expect(isEncryptionEnabled()).toBe(false);
		});
	});

	describe('isEncryptedValue', () => {
		it('returns true for encrypted values', () => {
			expect(isEncryptedValue('enc:v1:aabbcc:ddeeff:001122')).toBe(true);
		});

		it('returns false for plaintext values', () => {
			expect(isEncryptedValue('ghp_abc123')).toBe(false);
			expect(isEncryptedValue('sk-ant-api03-xxx')).toBe(false);
			expect(isEncryptedValue('')).toBe(false);
		});
	});

	describe('round-trip encrypt/decrypt', () => {
		it('encrypts and decrypts a simple string', () => {
			const plaintext = 'ghp_abc123def456';
			const aad = 'org-1';
			const encrypted = encryptCredential(plaintext, aad);
			expect(encrypted).toMatch(/^enc:v1:/);
			expect(encrypted).not.toContain(plaintext);

			const decrypted = decryptCredential(encrypted, aad);
			expect(decrypted).toBe(plaintext);
		});

		it('handles empty string', () => {
			const encrypted = encryptCredential('', 'org-1');
			expect(encrypted).toMatch(/^enc:v1:/);
			const decrypted = decryptCredential(encrypted, 'org-1');
			expect(decrypted).toBe('');
		});

		it('handles unicode characters', () => {
			const plaintext = '🔑 tøken with ünïcödé 日本語';
			const encrypted = encryptCredential(plaintext, 'org-1');
			const decrypted = decryptCredential(encrypted, 'org-1');
			expect(decrypted).toBe(plaintext);
		});

		it('handles long values', () => {
			const plaintext = 'x'.repeat(10000);
			const encrypted = encryptCredential(plaintext, 'org-1');
			const decrypted = decryptCredential(encrypted, 'org-1');
			expect(decrypted).toBe(plaintext);
		});
	});

	describe('randomness', () => {
		it('produces different ciphertexts for the same plaintext', () => {
			const plaintext = 'ghp_same_value';
			const aad = 'org-1';
			const enc1 = encryptCredential(plaintext, aad);
			const enc2 = encryptCredential(plaintext, aad);
			expect(enc1).not.toBe(enc2);

			// Both still decrypt to the same value
			expect(decryptCredential(enc1, aad)).toBe(plaintext);
			expect(decryptCredential(enc2, aad)).toBe(plaintext);
		});
	});

	describe('AAD binding', () => {
		it('fails decryption with wrong AAD (different org)', () => {
			const encrypted = encryptCredential('secret', 'org-1');
			expect(() => decryptCredential(encrypted, 'org-2')).toThrow();
		});
	});

	describe('tamper detection', () => {
		it('fails when ciphertext is tampered', () => {
			const encrypted = encryptCredential('secret', 'org-1');
			// Flip a character in the ciphertext portion
			const parts = encrypted.split(':');
			const lastPart = parts[parts.length - 1];
			const tampered = lastPart[0] === 'a' ? `b${lastPart.slice(1)}` : `a${lastPart.slice(1)}`;
			parts[parts.length - 1] = tampered;
			const tamperedStr = parts.join(':');

			expect(() => decryptCredential(tamperedStr, 'org-1')).toThrow();
		});

		it('fails when auth tag is tampered', () => {
			const encrypted = encryptCredential('secret', 'org-1');
			const parts = encrypted.split(':');
			// parts[3] is the auth tag
			const tag = parts[3];
			const tamperedTag = tag[0] === 'a' ? `b${tag.slice(1)}` : `a${tag.slice(1)}`;
			parts[3] = tamperedTag;
			const tamperedStr = parts.join(':');

			expect(() => decryptCredential(tamperedStr, 'org-1')).toThrow();
		});
	});

	describe('plaintext passthrough when no key', () => {
		it('encryptCredential returns plaintext when key not set', () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', '');
			const result = encryptCredential('ghp_abc123', 'org-1');
			expect(result).toBe('ghp_abc123');
		});

		it('decryptCredential passes through plaintext values', () => {
			const result = decryptCredential('ghp_abc123', 'org-1');
			expect(result).toBe('ghp_abc123');
		});
	});

	describe('reEncryptCredential', () => {
		it('decrypts with oldAad and re-encrypts with newAad', () => {
			const plaintext = 'ghp_abc123def456';
			const oldAad = 'org-1';
			const newAad = 'project-xyz';

			const originalEncrypted = encryptCredential(plaintext, oldAad);
			const reEncrypted = reEncryptCredential(originalEncrypted, oldAad, newAad);

			// Should still be encrypted
			expect(isEncryptedValue(reEncrypted)).toBe(true);
			// Should not equal the original (different AAD / random IV)
			expect(reEncrypted).not.toBe(originalEncrypted);
			// Should decrypt correctly with newAad
			expect(decryptCredential(reEncrypted, newAad)).toBe(plaintext);
			// Should NOT decrypt with oldAad
			expect(() => decryptCredential(reEncrypted, oldAad)).toThrow();
		});

		it('returns plaintext value unchanged when not encrypted', () => {
			const plaintext = 'ghp_plaintext';
			const result = reEncryptCredential(plaintext, 'org-1', 'project-xyz');
			expect(result).toBe(plaintext);
		});

		it('returns plaintext value unchanged when encryption is disabled', () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', '');
			const plaintext = 'ghp_plaintext';
			const result = reEncryptCredential(plaintext, 'org-1', 'project-xyz');
			expect(result).toBe(plaintext);
		});
	});

	describe('error cases', () => {
		it('throws when trying to decrypt encrypted value without key', () => {
			const encrypted = encryptCredential('secret', 'org-1');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', '');
			expect(() => decryptCredential(encrypted, 'org-1')).toThrow(
				'CREDENTIAL_MASTER_KEY is not set',
			);
		});

		it('throws on malformed key (wrong length)', () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'tooshort');
			expect(() => encryptCredential('secret', 'org-1')).toThrow('64-char hex string');
		});

		it('throws on malformed encrypted value (wrong number of parts)', () => {
			expect(() => decryptCredential('enc:v1:onlytwoparts', 'org-1')).toThrow(
				'Malformed encrypted credential',
			);
		});
	});
});

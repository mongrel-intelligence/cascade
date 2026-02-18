import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // NIST-recommended for GCM
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits
const PREFIX = 'enc:v1:';

function getMasterKey(): Buffer | null {
	const hex = process.env.CREDENTIAL_MASTER_KEY;
	if (!hex) return null;
	if (hex.length !== KEY_LENGTH * 2) {
		throw new Error(
			`CREDENTIAL_MASTER_KEY must be a ${KEY_LENGTH * 2}-char hex string (${KEY_LENGTH} bytes). Got ${hex.length} chars.`,
		);
	}
	return Buffer.from(hex, 'hex');
}

/** Returns true if CREDENTIAL_MASTER_KEY is set in the environment. */
export function isEncryptionEnabled(): boolean {
	return !!process.env.CREDENTIAL_MASTER_KEY;
}

/** Returns true if the value has the encrypted-value prefix. */
export function isEncryptedValue(value: string): boolean {
	return value.startsWith(PREFIX);
}

/**
 * Encrypt a credential value using AES-256-GCM.
 * Returns `enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`.
 * If no master key is configured, returns the plaintext unchanged.
 * @param aad - Additional Authenticated Data (orgId) to bind the ciphertext to the org.
 */
export function encryptCredential(plaintext: string, aad: string): string {
	const key = getMasterKey();
	if (!key) return plaintext;

	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
	cipher.setAAD(Buffer.from(aad, 'utf8'));

	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();

	return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a credential value.
 * If the value is not encrypted (no `enc:` prefix), returns it as-is.
 * Throws if the value is encrypted but no master key is configured.
 * @param aad - Additional Authenticated Data (must match the aad used during encryption).
 */
export function decryptCredential(stored: string, aad: string): string {
	if (!isEncryptedValue(stored)) return stored;

	const key = getMasterKey();
	if (!key) {
		throw new Error(
			'Credential is encrypted but CREDENTIAL_MASTER_KEY is not set. Cannot decrypt.',
		);
	}

	// Parse: enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
	const parts = stored.slice(PREFIX.length).split(':');
	if (parts.length !== 3) {
		throw new Error('Malformed encrypted credential value: expected enc:v1:<iv>:<tag>:<data>');
	}

	const [ivHex, authTagHex, ciphertextHex] = parts;
	const iv = Buffer.from(ivHex, 'hex');
	const authTag = Buffer.from(authTagHex, 'hex');
	const ciphertext = Buffer.from(ciphertextHex, 'hex');

	const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
	decipher.setAAD(Buffer.from(aad, 'utf8'));
	decipher.setAuthTag(authTag);

	const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	return decrypted.toString('utf8');
}

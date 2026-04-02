#!/usr/bin/env tsx
/**
 * Rotate the credential encryption master key.
 * Decrypts all credentials with the current key, re-encrypts with the new key.
 *
 * Requires:
 *   CREDENTIAL_MASTER_KEY     - current key (for decryption)
 *   CREDENTIAL_MASTER_KEY_NEW - new key (for re-encryption)
 *
 * Usage:
 *   CREDENTIAL_MASTER_KEY=<old> CREDENTIAL_MASTER_KEY_NEW=<new> npx tsx tools/rotate-credential-key.ts [--dry-run]
 */

import { createCipheriv, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db/client.js';
import { decryptCredential, isEncryptedValue, isEncryptionEnabled } from '../src/db/crypto.js';
import { projectCredentials } from '../src/db/schema/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PREFIX = 'enc:v1:';

function encryptWithKey(plaintext: string, aad: string, keyHex: string): string {
	const key = Buffer.from(keyHex, 'hex');
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
	cipher.setAAD(Buffer.from(aad, 'utf8'));
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

async function main() {
	const dryRun = process.argv.includes('--dry-run');

	if (!isEncryptionEnabled()) {
		console.error('Error: CREDENTIAL_MASTER_KEY env var is not set.');
		process.exit(1);
	}

	const newKeyHex = process.env.CREDENTIAL_MASTER_KEY_NEW;
	if (!newKeyHex) {
		console.error('Error: CREDENTIAL_MASTER_KEY_NEW env var is not set.');
		process.exit(1);
	}
	if (newKeyHex.length !== KEY_LENGTH * 2) {
		console.error(
			`Error: CREDENTIAL_MASTER_KEY_NEW must be a ${KEY_LENGTH * 2}-char hex string. Got ${newKeyHex.length} chars.`,
		);
		process.exit(1);
	}

	const db = getDb();
	const allCreds = await db
		.select({
			id: projectCredentials.id,
			projectId: projectCredentials.projectId,
			value: projectCredentials.value,
		})
		.from(projectCredentials);

	let rotated = 0;
	const _skipped = 0;

	for (const cred of allCreds) {
		// Decrypt with current key (handles both encrypted and plaintext)
		const plaintext = isEncryptedValue(cred.value)
			? decryptCredential(cred.value, cred.projectId)
			: cred.value;

		// Re-encrypt with new key
		const reEncrypted = encryptWithKey(plaintext, cred.projectId, newKeyHex);

		if (dryRun) {
			console.log(`  #${cred.id}: would re-encrypt`);
		} else {
			await db
				.update(projectCredentials)
				.set({ value: reEncrypted, updatedAt: new Date() })
				.where(eq(projectCredentials.id, cred.id));
			console.log(`  #${cred.id}: re-encrypted`);
		}
		rotated++;
	}

	console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Done: ${rotated} rotated, ${allCreds.length} total`);
	if (!dryRun) {
		console.log(
			'\nIMPORTANT: Update CREDENTIAL_MASTER_KEY to the new key value and restart CASCADE.',
		);
	}

	await closeDb();
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});

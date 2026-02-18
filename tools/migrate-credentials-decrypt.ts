#!/usr/bin/env tsx
/**
 * Reverse migration: decrypt all encrypted credentials back to plaintext.
 * Requires CREDENTIAL_MASTER_KEY env var.
 *
 * Usage:
 *   CREDENTIAL_MASTER_KEY=<key> npx tsx tools/migrate-credentials-decrypt.ts [--dry-run]
 */

import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db/client.js';
import { decryptCredential, isEncryptedValue, isEncryptionEnabled } from '../src/db/crypto.js';
import { credentials } from '../src/db/schema/index.js';

async function main() {
	const dryRun = process.argv.includes('--dry-run');

	if (!isEncryptionEnabled()) {
		console.error('Error: CREDENTIAL_MASTER_KEY env var is not set.');
		process.exit(1);
	}

	const db = getDb();
	const allCreds = await db
		.select({ id: credentials.id, orgId: credentials.orgId, value: credentials.value })
		.from(credentials);

	let decrypted = 0;
	let skipped = 0;

	for (const cred of allCreds) {
		if (!isEncryptedValue(cred.value)) {
			skipped++;
			console.log(`  #${cred.id}: plaintext, skipping`);
			continue;
		}

		const plaintextValue = decryptCredential(cred.value, cred.orgId);
		if (dryRun) {
			console.log(
				`  #${cred.id}: would decrypt (${cred.value.length} chars → ${plaintextValue.length} chars)`,
			);
		} else {
			await db
				.update(credentials)
				.set({ value: plaintextValue, updatedAt: new Date() })
				.where(eq(credentials.id, cred.id));
			console.log(`  #${cred.id}: decrypted`);
		}
		decrypted++;
	}

	console.log(
		`\n${dryRun ? '[DRY RUN] ' : ''}Done: ${decrypted} decrypted, ${skipped} skipped (already plaintext), ${allCreds.length} total`,
	);

	await closeDb();
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});

#!/usr/bin/env tsx
/**
 * Migrate existing plaintext credentials to encrypted values.
 * Requires CREDENTIAL_MASTER_KEY env var.
 *
 * Usage:
 *   CREDENTIAL_MASTER_KEY=<key> npx tsx tools/migrate-credentials-encrypt.ts [--dry-run]
 */

import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db/client.js';
import { encryptCredential, isEncryptedValue, isEncryptionEnabled } from '../src/db/crypto.js';
import { projectCredentials } from '../src/db/schema/index.js';

async function main() {
	const dryRun = process.argv.includes('--dry-run');

	if (!isEncryptionEnabled()) {
		console.error('Error: CREDENTIAL_MASTER_KEY env var is not set.');
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

	let encrypted = 0;
	let skipped = 0;

	for (const cred of allCreds) {
		if (isEncryptedValue(cred.value)) {
			skipped++;
			console.log(`  #${cred.id}: already encrypted, skipping`);
			continue;
		}

		const encryptedValue = encryptCredential(cred.value, cred.projectId);
		if (dryRun) {
			console.log(
				`  #${cred.id}: would encrypt (${cred.value.length} chars → ${encryptedValue.length} chars)`,
			);
		} else {
			await db
				.update(projectCredentials)
				.set({ value: encryptedValue, updatedAt: new Date() })
				.where(eq(projectCredentials.id, cred.id));
			console.log(`  #${cred.id}: encrypted`);
		}
		encrypted++;
	}

	console.log(
		`\n${dryRun ? '[DRY RUN] ' : ''}Done: ${encrypted} encrypted, ${skipped} skipped (already encrypted), ${allCreds.length} total`,
	);

	await closeDb();
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});

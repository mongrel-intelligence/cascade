#!/usr/bin/env tsx
/**
 * Re-encrypt project_credentials rows from orgId AAD to projectId AAD.
 *
 * Migration 0040 backfilled project_credentials by copying values from the
 * credentials table. Those values were encrypted with orgId as GCM AAD.
 * The new code decrypts with projectId as AAD — causing auth tag failures.
 *
 * This script detects and re-encrypts affected rows. It is idempotent: rows
 * already encrypted with projectId AAD are detected and skipped.
 *
 * Exits 0 when CREDENTIAL_MASTER_KEY is not set (encryption disabled, nothing to do).
 * Exits 1 if any row could not be decrypted with either AAD (data integrity issue).
 *
 * Usage:
 *   CREDENTIAL_MASTER_KEY=<key> npx tsx tools/migrate-project-credentials-reencrypt.ts [--dry-run]
 */

import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db/client.js';
import {
	decryptCredential,
	isEncryptedValue,
	isEncryptionEnabled,
	reEncryptCredential,
} from '../src/db/crypto.js';
import { projectCredentials } from '../src/db/schema/index.js';
import { projects } from '../src/db/schema/projects.js';

export interface CredentialRow {
	id: number;
	projectId: string;
	orgId: string;
	value: string;
}

export interface ProcessResult {
	reencrypted: number;
	alreadyCorrect: number;
	plaintext: number;
	failed: number;
}

/**
 * Classify and re-encrypt a batch of credential rows.
 * Exported for unit testing — has no DB or process.exit() side effects.
 */
export async function processRows(
	rows: CredentialRow[],
	opts: {
		dryRun: boolean;
		updateFn: (id: number, newValue: string) => Promise<void>;
	},
): Promise<ProcessResult> {
	let reencrypted = 0;
	let alreadyCorrect = 0;
	let plaintext = 0;
	let failed = 0;

	for (const row of rows) {
		if (!isEncryptedValue(row.value)) {
			plaintext++;
			continue;
		}

		// Check if already encrypted with projectId AAD
		try {
			decryptCredential(row.value, row.projectId);
			alreadyCorrect++;
			continue;
		} catch {
			// Falls through to re-encryption attempt
		}

		// Try re-encrypting from orgId AAD to projectId AAD
		try {
			const reencryptedValue = reEncryptCredential(row.value, row.orgId, row.projectId);
			if (opts.dryRun) {
				console.log(
					`  #${row.id} (project=${row.projectId}): would re-encrypt (orgId → projectId AAD)`,
				);
			} else {
				await opts.updateFn(row.id, reencryptedValue);
				console.log(`  #${row.id} (project=${row.projectId}): re-encrypted`);
			}
			reencrypted++;
		} catch (err) {
			console.warn(
				`  #${row.id} (project=${row.projectId}): WARNING — could not decrypt with either orgId or projectId AAD, skipping. Error: ${err instanceof Error ? err.message : String(err)}`,
			);
			failed++;
		}
	}

	return { reencrypted, alreadyCorrect, plaintext, failed };
}

async function main() {
	const dryRun = process.argv.includes('--dry-run');

	console.log(`\nProject Credentials Re-encryption${dryRun ? ' (DRY RUN)' : ''}`);
	console.log('='.repeat(50));

	if (!isEncryptionEnabled()) {
		console.log('CREDENTIAL_MASTER_KEY is not set — encryption disabled, nothing to do.');
		process.exit(0);
	}

	const db = getDb();
	const rows = await db
		.select({
			id: projectCredentials.id,
			projectId: projectCredentials.projectId,
			orgId: projects.orgId,
			value: projectCredentials.value,
		})
		.from(projectCredentials)
		.innerJoin(projects, eq(projectCredentials.projectId, projects.id));

	const result = await processRows(rows, {
		dryRun,
		updateFn: async (id, newValue) => {
			await db
				.update(projectCredentials)
				.set({ value: newValue, updatedAt: new Date() })
				.where(eq(projectCredentials.id, id));
		},
	});

	console.log(`\n${'='.repeat(50)}`);
	console.log(`${dryRun ? '[DRY RUN] ' : ''}Summary:`);
	console.log(`  Re-encrypted:    ${result.reencrypted}`);
	console.log(`  Already correct: ${result.alreadyCorrect}`);
	console.log(`  Plaintext:       ${result.plaintext}`);
	console.log(`  Failed:          ${result.failed}`);
	console.log(`  Total:           ${rows.length}`);

	await closeDb();

	if (result.failed > 0) {
		console.error(
			`\nERROR: ${result.failed} row(s) could not be decrypted with either orgId or projectId AAD.`,
		);
		console.error('These credentials are unreadable and require manual investigation.');
		process.exit(1);
	}
}

// Only execute when run directly (not when imported for testing)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error('Error:', err);
		process.exit(1);
	});
}

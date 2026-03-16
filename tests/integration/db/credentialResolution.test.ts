import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllProjectCredentials } from '../../../src/config/provider.js';
import { getDb } from '../../../src/db/client.js';
import { isEncryptedValue } from '../../../src/db/crypto.js';
import {
	listProjectCredentials,
	upsertProjectCredential,
	writeProjectCredential,
} from '../../../src/db/repositories/credentialsRepository.js';
import { projectCredentials } from '../../../src/db/schema/index.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject } from '../helpers/seed.js';

describe('credentialResolution (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// getAllProjectCredentials — end-to-end
	// =========================================================================

	describe('getAllProjectCredentials', () => {
		it('returns empty object when no credentials configured', async () => {
			const creds = await getAllProjectCredentials('test-project');
			expect(creds).toEqual({});
		});

		it('includes project credentials', async () => {
			await writeProjectCredential('test-project', 'OPENROUTER_API_KEY', 'or-key-secret');

			const creds = await getAllProjectCredentials('test-project');
			expect(creds.OPENROUTER_API_KEY).toBe('or-key-secret');
		});

		it('includes all project credentials in the map', async () => {
			await writeProjectCredential('test-project', 'GITHUB_TOKEN_IMPLEMENTER', 'ghp-impl');
			await writeProjectCredential('test-project', 'TRELLO_API_KEY', 'trello-key');
			await writeProjectCredential('test-project', 'OPENROUTER_API_KEY', 'llm-key');

			const creds = await getAllProjectCredentials('test-project');
			expect(creds.GITHUB_TOKEN_IMPLEMENTER).toBe('ghp-impl');
			expect(creds.TRELLO_API_KEY).toBe('trello-key');
			expect(creds.OPENROUTER_API_KEY).toBe('llm-key');
		});

		it('throws when project not found', async () => {
			await expect(getAllProjectCredentials('nonexistent-project')).rejects.toThrow(
				'Project not found: nonexistent-project',
			);
		});
	});

	// =========================================================================
	// Encryption round-trip
	// =========================================================================

	describe('with encryption', () => {
		it('round-trips credentials through encrypt/decrypt transparently', async () => {
			// 64-char hex = 32-byte AES-256 key
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'b'.repeat(64));

			await writeProjectCredential('test-project', 'OPENROUTER_API_KEY', 'plaintext-llm-secret');

			// getAllProjectCredentials should transparently decrypt
			const creds = await getAllProjectCredentials('test-project');
			expect(creds.OPENROUTER_API_KEY).toBe('plaintext-llm-secret');
		});
	});

	// =========================================================================
	// Worker context
	// =========================================================================

	describe('worker context (CASCADE_CREDENTIAL_KEYS set)', () => {
		it('returns credentials from process.env when CASCADE_CREDENTIAL_KEYS is set', async () => {
			vi.stubEnv('CASCADE_CREDENTIAL_KEYS', 'OPENROUTER_API_KEY,GITHUB_TOKEN_IMPLEMENTER');
			vi.stubEnv('OPENROUTER_API_KEY', 'env-llm-key');
			vi.stubEnv('GITHUB_TOKEN_IMPLEMENTER', 'env-gh-token');

			const creds = await getAllProjectCredentials('test-project');
			expect(creds.OPENROUTER_API_KEY).toBe('env-llm-key');
			expect(creds.GITHUB_TOKEN_IMPLEMENTER).toBe('env-gh-token');
		});
	});

	// =========================================================================
	// Multi-project AAD isolation
	// =========================================================================

	describe('multi-project AAD isolation', () => {
		it('encrypts credentials with projectId as AAD — cross-project contamination is impossible', async () => {
			// Seed a second project (different repo to avoid unique constraint on repo)
			await seedProject({ id: 'project-b', name: 'Project B', repo: 'owner/repo-b' });

			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'a'.repeat(64));

			// Write the same key name to both projects with different values
			await writeProjectCredential('test-project', 'API_SECRET', 'secret-for-project-a');
			await writeProjectCredential('project-b', 'API_SECRET', 'secret-for-project-b');

			// Each project reads its own value
			const credsA = await getAllProjectCredentials('test-project');
			const credsB = await getAllProjectCredentials('project-b');

			expect(credsA.API_SECRET).toBe('secret-for-project-a');
			expect(credsB.API_SECRET).toBe('secret-for-project-b');

			// Values are different, not cross-contaminated
			expect(credsA.API_SECRET).not.toBe(credsB.API_SECRET);

			// The raw stored ciphertexts should differ (different AAD produces different ciphertext)
			const db = getDb();
			const [rowA] = await db
				.select({ value: projectCredentials.value })
				.from(projectCredentials)
				.where(
					and(
						eq(projectCredentials.projectId, 'test-project'),
						eq(projectCredentials.envVarKey, 'API_SECRET'),
					),
				);
			const [rowB] = await db
				.select({ value: projectCredentials.value })
				.from(projectCredentials)
				.where(
					and(
						eq(projectCredentials.projectId, 'project-b'),
						eq(projectCredentials.envVarKey, 'API_SECRET'),
					),
				);

			// Both should be encrypted
			expect(isEncryptedValue(rowA.value)).toBe(true);
			expect(isEncryptedValue(rowB.value)).toBe(true);

			// Ciphertexts differ because AAD (projectId) is different
			expect(rowA.value).not.toBe(rowB.value);
		});
	});

	// =========================================================================
	// Mixed plaintext / encrypted credentials
	// =========================================================================

	describe('mixed plaintext/encrypted credentials', () => {
		it('reads both plaintext and encrypted credentials via getAllProjectCredentials', async () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'c'.repeat(64));

			// Write one credential while encryption is enabled
			await writeProjectCredential('test-project', 'ENCRYPTED_KEY', 'encrypted-value');

			// Write a second credential in plaintext by bypassing the high-level helper
			// (simulates a credential that existed before encryption was enabled)
			await upsertProjectCredential('test-project', 'PLAINTEXT_KEY', 'plaintext-value');

			// Verify storage: one should be encrypted, one should be plaintext
			const db = getDb();
			const rows = await db
				.select({ envVarKey: projectCredentials.envVarKey, value: projectCredentials.value })
				.from(projectCredentials)
				.where(eq(projectCredentials.projectId, 'test-project'));

			const encryptedRawValue = rows.find((r) => r.envVarKey === 'ENCRYPTED_KEY')?.value;
			const plaintextRawValue = rows.find((r) => r.envVarKey === 'PLAINTEXT_KEY')?.value;

			expect(encryptedRawValue).toBeDefined();
			expect(plaintextRawValue).toBeDefined();
			expect(isEncryptedValue(encryptedRawValue ?? '')).toBe(true);
			expect(isEncryptedValue(plaintextRawValue ?? '')).toBe(false);
			expect(plaintextRawValue).toBe('plaintext-value');

			// getAllProjectCredentials should transparently handle both formats
			const creds = await getAllProjectCredentials('test-project');
			expect(creds.ENCRYPTED_KEY).toBe('encrypted-value');
			expect(creds.PLAINTEXT_KEY).toBe('plaintext-value');

			// listProjectCredentials should also handle both formats
			const list = await listProjectCredentials('test-project');
			const encryptedEntry = list.find((e) => e.envVarKey === 'ENCRYPTED_KEY');
			const plaintextEntry = list.find((e) => e.envVarKey === 'PLAINTEXT_KEY');
			expect(encryptedEntry?.value).toBe('encrypted-value');
			expect(plaintextEntry?.value).toBe('plaintext-value');
		});
	});

	// =========================================================================
	// Upsert re-encryption (fresh IV on every write)
	// =========================================================================

	describe('upsert re-encryption', () => {
		it('generates a fresh IV when a credential is overwritten', async () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'd'.repeat(64));

			// Write initial credential value
			await writeProjectCredential('test-project', 'MY_SECRET', 'initial-value');

			// Read the raw DB value to capture the first IV
			const db = getDb();
			const [firstRow] = await db
				.select({ value: projectCredentials.value })
				.from(projectCredentials)
				.where(
					and(
						eq(projectCredentials.projectId, 'test-project'),
						eq(projectCredentials.envVarKey, 'MY_SECRET'),
					),
				);

			expect(isEncryptedValue(firstRow.value)).toBe(true);

			// Parse the IV out of enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
			const firstParts = firstRow.value.split(':');
			// Format is enc:v1:<iv>:<tag>:<data> → parts[2] is iv
			const firstIv = firstParts[2];

			// Overwrite with a new value
			await writeProjectCredential('test-project', 'MY_SECRET', 'updated-value');

			// Read the raw DB value again
			const [secondRow] = await db
				.select({ value: projectCredentials.value })
				.from(projectCredentials)
				.where(
					and(
						eq(projectCredentials.projectId, 'test-project'),
						eq(projectCredentials.envVarKey, 'MY_SECRET'),
					),
				);

			expect(isEncryptedValue(secondRow.value)).toBe(true);

			const secondParts = secondRow.value.split(':');
			const secondIv = secondParts[2];

			// IVs must differ — fresh randomness on every write
			expect(firstIv).not.toBe(secondIv);

			// Full ciphertext strings should differ (new IV + new ciphertext)
			expect(firstRow.value).not.toBe(secondRow.value);

			// The decrypted value should be the new value
			const creds = await getAllProjectCredentials('test-project');
			expect(creds.MY_SECRET).toBe('updated-value');
		});
	});
});

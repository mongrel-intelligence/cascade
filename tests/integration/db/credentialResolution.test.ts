import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllProjectCredentials } from '../../../src/config/provider.js';
import { writeProjectCredential } from '../../../src/db/repositories/credentialsRepository.js';
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
});

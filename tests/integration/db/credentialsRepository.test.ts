import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createCredential,
	deleteCredential,
	listOrgCredentials,
	resolveAllIntegrationCredentials,
	resolveAllOrgCredentials,
	resolveIntegrationCredential,
	resolveOrgCredential,
	updateCredential,
} from '../../../src/db/repositories/credentialsRepository.js';
import { truncateAll } from '../helpers/db.js';
import {
	seedCredential,
	seedIntegration,
	seedIntegrationCredential,
	seedOrg,
	seedProject,
} from '../helpers/seed.js';

describe('credentialsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// CRUD
	// =========================================================================

	describe('createCredential', () => {
		it('inserts a credential and returns the id', async () => {
			const result = await createCredential({
				orgId: 'test-org',
				name: 'My API Key',
				envVarKey: 'MY_API_KEY',
				value: 'secret-123',
			});

			expect(result.id).toBeGreaterThan(0);
		});

		it('defaults isDefault to false', async () => {
			const { id } = await createCredential({
				orgId: 'test-org',
				name: 'Key',
				envVarKey: 'KEY',
				value: 'val',
			});

			const creds = await listOrgCredentials('test-org');
			const cred = creds.find((c) => c.id === id);
			expect(cred?.isDefault).toBe(false);
		});
	});

	describe('updateCredential', () => {
		it('updates name and value', async () => {
			const { id } = await createCredential({
				orgId: 'test-org',
				name: 'Old Name',
				envVarKey: 'UPD_KEY',
				value: 'old-value',
			});

			await updateCredential(id, { name: 'New Name', value: 'new-value' });

			const creds = await listOrgCredentials('test-org');
			const cred = creds.find((c) => c.id === id);
			expect(cred?.name).toBe('New Name');
			expect(cred?.value).toBe('new-value');
		});
	});

	describe('deleteCredential', () => {
		it('removes the credential', async () => {
			const { id } = await createCredential({
				orgId: 'test-org',
				name: 'Temp',
				envVarKey: 'TEMP',
				value: 'tmp',
			});

			await deleteCredential(id);

			const creds = await listOrgCredentials('test-org');
			expect(creds.find((c) => c.id === id)).toBeUndefined();
		});
	});

	describe('listOrgCredentials', () => {
		it('returns all credentials for the org', async () => {
			await createCredential({ orgId: 'test-org', name: 'A', envVarKey: 'A', value: 'a' });
			await createCredential({ orgId: 'test-org', name: 'B', envVarKey: 'B', value: 'b' });

			const creds = await listOrgCredentials('test-org');
			expect(creds).toHaveLength(2);
			expect(creds.map((c) => c.envVarKey).sort()).toEqual(['A', 'B']);
		});

		it('returns empty array for org with no credentials', async () => {
			const creds = await listOrgCredentials('test-org');
			expect(creds).toEqual([]);
		});
	});

	// =========================================================================
	// Org-scoped credential resolution
	// =========================================================================

	describe('resolveOrgCredential', () => {
		it('returns value for a default credential', async () => {
			await createCredential({
				orgId: 'test-org',
				name: 'OR Key',
				envVarKey: 'OPENROUTER_API_KEY',
				value: 'or-secret',
				isDefault: true,
			});

			const result = await resolveOrgCredential('test-org', 'OPENROUTER_API_KEY');
			expect(result).toBe('or-secret');
		});

		it('returns null for non-default credential', async () => {
			await createCredential({
				orgId: 'test-org',
				name: 'Non-default',
				envVarKey: 'NON_DEFAULT',
				value: 'val',
				isDefault: false,
			});

			const result = await resolveOrgCredential('test-org', 'NON_DEFAULT');
			expect(result).toBeNull();
		});

		it('returns null when credential does not exist', async () => {
			const result = await resolveOrgCredential('test-org', 'MISSING_KEY');
			expect(result).toBeNull();
		});
	});

	describe('resolveAllOrgCredentials', () => {
		it('returns all default credentials as key-value map', async () => {
			await createCredential({
				orgId: 'test-org',
				name: 'K1',
				envVarKey: 'KEY_1',
				value: 'v1',
				isDefault: true,
			});
			await createCredential({
				orgId: 'test-org',
				name: 'K2',
				envVarKey: 'KEY_2',
				value: 'v2',
				isDefault: true,
			});
			// Non-default — should be excluded
			await createCredential({
				orgId: 'test-org',
				name: 'K3',
				envVarKey: 'KEY_3',
				value: 'v3',
				isDefault: false,
			});

			const result = await resolveAllOrgCredentials('test-org');
			expect(result).toEqual({ KEY_1: 'v1', KEY_2: 'v2' });
		});
	});

	// =========================================================================
	// Integration credential resolution
	// =========================================================================

	describe('resolveIntegrationCredential', () => {
		it('resolves a credential via integration link', async () => {
			const cred = await seedCredential({
				envVarKey: 'TRELLO_API_KEY',
				value: 'trello-key-secret',
			});
			const integration = await seedIntegration({ category: 'pm', provider: 'trello' });
			await seedIntegrationCredential({
				integrationId: integration.id,
				role: 'api_key',
				credentialId: cred.id,
			});

			const result = await resolveIntegrationCredential('test-project', 'pm', 'api_key');
			expect(result).toBe('trello-key-secret');
		});

		it('returns null when no link exists', async () => {
			const result = await resolveIntegrationCredential('test-project', 'pm', 'api_key');
			expect(result).toBeNull();
		});
	});

	describe('resolveAllIntegrationCredentials', () => {
		it('resolves all credentials for a project', async () => {
			const apiKeyCred = await seedCredential({ envVarKey: 'TRELLO_API_KEY', value: 'key1' });
			const tokenCred = await seedCredential({
				envVarKey: 'TRELLO_TOKEN',
				value: 'token1',
				name: 'Trello Token',
			});
			const integration = await seedIntegration({ category: 'pm', provider: 'trello' });
			await seedIntegrationCredential({
				integrationId: integration.id,
				role: 'api_key',
				credentialId: apiKeyCred.id,
			});
			await seedIntegrationCredential({
				integrationId: integration.id,
				role: 'token',
				credentialId: tokenCred.id,
			});

			const result = await resolveAllIntegrationCredentials('test-project');
			expect(result).toHaveLength(2);
			expect(result).toEqual(
				expect.arrayContaining([
					{ category: 'pm', provider: 'trello', role: 'api_key', value: 'key1' },
					{ category: 'pm', provider: 'trello', role: 'token', value: 'token1' },
				]),
			);
		});

		it('returns empty array for project with no integrations', async () => {
			const result = await resolveAllIntegrationCredentials('test-project');
			expect(result).toEqual([]);
		});
	});

	// =========================================================================
	// Encryption
	// =========================================================================

	describe('with encryption', () => {
		it('round-trips through encrypt/decrypt transparently', async () => {
			// 64-char hex = 32-byte AES-256 key
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'a'.repeat(64));

			const { id } = await createCredential({
				orgId: 'test-org',
				name: 'Encrypted Key',
				envVarKey: 'ENC_KEY',
				value: 'plaintext-secret',
			});

			const creds = await listOrgCredentials('test-org');
			const cred = creds.find((c) => c.id === id);
			expect(cred?.value).toBe('plaintext-secret'); // decrypted on read
		});
	});
});

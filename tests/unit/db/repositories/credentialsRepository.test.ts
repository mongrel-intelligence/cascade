import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '../../../helpers/mockDb.js';

// Mock the DB client
vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

import { getDb } from '../../../../src/db/client.js';
import {
	createCredential,
	deleteCredential,
	getIntegrationProvider,
	listOrgCredentials,
	resolveAllIntegrationCredentials,
	resolveAllOrgCredentials,
	resolveIntegrationCredential,
	resolveOrgCredential,
	updateCredential,
	upsertCredentialByEnvVarKey,
	upsertGmailIntegrationWithCredentials,
} from '../../../../src/db/repositories/credentialsRepository.js';

describe('credentialsRepository', () => {
	let mockDb: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		mockDb = createMockDb({ withDoubleJoin: true });
		vi.mocked(getDb).mockReturnValue(mockDb.db as never);
	});

	describe('resolveIntegrationCredential', () => {
		it('returns decrypted value when found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ value: 'trello-api-key', orgId: 'org1' }]);

			const result = await resolveIntegrationCredential('proj1', 'pm', 'api_key');
			expect(result).toBe('trello-api-key');
		});

		it('returns null when not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await resolveIntegrationCredential('proj1', 'pm', 'api_key');
			expect(result).toBeNull();
		});
	});

	describe('resolveAllIntegrationCredentials', () => {
		it('returns all integration credentials for a project', async () => {
			mockDb.chain.where.mockResolvedValueOnce([
				{ category: 'pm', provider: 'trello', role: 'api_key', value: 'tkey', orgId: 'org1' },
				{ category: 'pm', provider: 'trello', role: 'token', value: 'ttoken', orgId: 'org1' },
				{
					category: 'scm',
					provider: 'github',
					role: 'implementer_token',
					value: 'ghp_impl',
					orgId: 'org1',
				},
			]);

			const result = await resolveAllIntegrationCredentials('proj1');
			expect(result).toHaveLength(3);
			expect(result[0]).toEqual({
				category: 'pm',
				provider: 'trello',
				role: 'api_key',
				value: 'tkey',
			});
			expect(result[2]).toEqual({
				category: 'scm',
				provider: 'github',
				role: 'implementer_token',
				value: 'ghp_impl',
			});
		});

		it('returns empty array when no integration credentials exist', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await resolveAllIntegrationCredentials('proj1');
			expect(result).toEqual([]);
		});
	});

	describe('resolveOrgCredential', () => {
		it('returns value when org default exists', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ value: 'or-api-key' }]);

			const result = await resolveOrgCredential('org1', 'OPENROUTER_API_KEY');
			expect(result).toBe('or-api-key');
		});

		it('returns null when no org default', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await resolveOrgCredential('org1', 'MISSING_KEY');
			expect(result).toBeNull();
		});
	});

	describe('resolveAllOrgCredentials', () => {
		it('returns all org default credentials as key-value map', async () => {
			mockDb.chain.where.mockResolvedValueOnce([
				{ envVarKey: 'OPENROUTER_API_KEY', value: 'or-key' },
				{ envVarKey: 'ANTHROPIC_API_KEY', value: 'ant-key' },
			]);

			const result = await resolveAllOrgCredentials('org1');
			expect(result).toEqual({
				OPENROUTER_API_KEY: 'or-key',
				ANTHROPIC_API_KEY: 'ant-key',
			});
		});

		it('returns empty object when no credentials', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await resolveAllOrgCredentials('org1');
			expect(result).toEqual({});
		});
	});

	describe('createCredential', () => {
		it('inserts credential and returns id (no encryption key)', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 42 }]);

			const result = await createCredential({
				orgId: 'org1',
				name: 'GitHub Bot',
				envVarKey: 'GITHUB_TOKEN',
				value: 'ghp_abc123',
				isDefault: true,
			});

			expect(result).toEqual({ id: 42 });
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			// Without CREDENTIAL_MASTER_KEY, value passes through as plaintext
			expect(mockDb.chain.values).toHaveBeenCalledWith({
				orgId: 'org1',
				name: 'GitHub Bot',
				envVarKey: 'GITHUB_TOKEN',
				value: 'ghp_abc123',
				isDefault: true,
			});
		});

		it('encrypts value when CREDENTIAL_MASTER_KEY is set', async () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', randomBytes(32).toString('hex'));
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 42 }]);

			await createCredential({
				orgId: 'org1',
				name: 'GitHub Bot',
				envVarKey: 'GITHUB_TOKEN',
				value: 'ghp_abc123',
				isDefault: true,
			});

			const insertedValues = mockDb.chain.values.mock.calls[0][0];
			expect(insertedValues.value).toMatch(/^enc:v1:/);
			expect(insertedValues.value).not.toContain('ghp_abc123');
		});

		it('defaults isDefault to false', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 1 }]);

			await createCredential({
				orgId: 'org1',
				name: 'Key',
				envVarKey: 'KEY',
				value: 'val',
			});

			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({ isDefault: false }),
			);
		});
	});

	describe('updateCredential', () => {
		it('updates specified fields (no encryption key)', async () => {
			// First call: orgId lookup for encryption
			mockDb.chain.where.mockResolvedValueOnce([{ orgId: 'org1' }]);
			// Second call: the actual update
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateCredential(42, { name: 'New Name', value: 'new-secret' });

			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.set).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'New Name',
					value: 'new-secret',
				}),
			);
		});

		it('encrypts value on update when CREDENTIAL_MASTER_KEY is set', async () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', randomBytes(32).toString('hex'));
			// First call: orgId lookup
			mockDb.chain.where.mockResolvedValueOnce([{ orgId: 'org1' }]);
			// Second call: the actual update
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateCredential(42, { value: 'new-secret' });

			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.value).toMatch(/^enc:v1:/);
			expect(setArg.value).not.toContain('new-secret');
		});

		it('looks up orgId before encrypting value', async () => {
			// First call: orgId lookup
			mockDb.chain.where.mockResolvedValueOnce([{ orgId: 'org1' }]);
			// Second call: the actual update
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateCredential(42, { value: 'new-secret' });

			// Should have done a select (orgId lookup) + update
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
		});

		it('includes updatedAt timestamp', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateCredential(1, { name: 'updated name' });

			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.updatedAt).toBeInstanceOf(Date);
			expect(setArg.name).toBe('updated name');
		});

		it('only updates provided fields', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateCredential(1, { isDefault: true });

			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.isDefault).toBe(true);
			expect(setArg.name).toBeUndefined();
			expect(setArg.value).toBeUndefined();
		});
	});

	describe('deleteCredential', () => {
		it('deletes by id', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteCredential(42);

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});
	});

	describe('listOrgCredentials', () => {
		it('returns credentials for org (decrypted)', async () => {
			const mockCreds = [
				{ id: 1, orgId: 'org1', name: 'Key 1', envVarKey: 'KEY1', value: 'v1', isDefault: true },
				{ id: 2, orgId: 'org1', name: 'Key 2', envVarKey: 'KEY2', value: 'v2', isDefault: false },
			];
			mockDb.chain.where.mockResolvedValueOnce(mockCreds);

			const result = await listOrgCredentials('org1');
			expect(result).toHaveLength(2);
			expect(result[0].name).toBe('Key 1');
			// Plaintext values pass through decryptCredential unchanged
			expect(result[0].value).toBe('v1');
		});

		it('returns empty array when no credentials', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await listOrgCredentials('empty-org');
			expect(result).toEqual([]);
		});
	});

	describe('upsertCredentialByEnvVarKey', () => {
		it('updates existing credential when found (find→update branch)', async () => {
			// First where: find existing credential → found
			mockDb.chain.where.mockResolvedValueOnce([{ id: 10 }]);
			// Second where: the update().set().where() call
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			const result = await upsertCredentialByEnvVarKey({
				orgId: 'org1',
				envVarKey: 'GMAIL_EMAIL',
				name: 'Gmail Email',
				value: 'user@example.com',
			});

			expect(result).toBe(10);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.set).toHaveBeenCalledWith(
				expect.objectContaining({ value: 'user@example.com' }),
			);
			expect(mockDb.db.insert).not.toHaveBeenCalled();
		});

		it('inserts new credential when not found (not-found→insert branch)', async () => {
			// First where: find existing credential → not found
			mockDb.chain.where.mockResolvedValueOnce([]);
			// returning: the insert().values().returning() call
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 99 }]);

			const result = await upsertCredentialByEnvVarKey({
				orgId: 'org1',
				envVarKey: 'GMAIL_REFRESH_TOKEN',
				name: 'Gmail Refresh Token',
				value: 'refresh-token-abc',
			});

			expect(result).toBe(99);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
			expect(mockDb.db.update).not.toHaveBeenCalled();
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					orgId: 'org1',
					envVarKey: 'GMAIL_REFRESH_TOKEN',
					name: 'Gmail Refresh Token',
					value: 'refresh-token-abc',
					isDefault: false,
				}),
			);
		});

		it('stores the (encrypted) value when inserting', async () => {
			// Not found → insert path
			mockDb.chain.where.mockResolvedValueOnce([]);
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 5 }]);

			await upsertCredentialByEnvVarKey({
				orgId: 'org1',
				envVarKey: 'KEY',
				name: 'Key Name',
				value: 'plaintext',
			});

			// Without CREDENTIAL_MASTER_KEY, encryptCredential passes through the value
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({ value: 'plaintext' }),
			);
		});
	});

	describe('upsertGmailIntegrationWithCredentials', () => {
		it('updates existing integration and replaces credential links (existing→update path)', async () => {
			// Step 1: find existing integration → found
			mockDb.chain.where.mockResolvedValueOnce([{ id: 7 }]);
			// Step 2: update integration → where
			mockDb.chain.where.mockResolvedValueOnce(undefined);
			// Step 3: delete existing credential links → where
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			// For the final insert().values() without .returning(), we need values to be thenable
			mockDb.chain.values.mockResolvedValueOnce(undefined);

			const result = await upsertGmailIntegrationWithCredentials({
				projectId: 'proj1',
				credentialLinks: [
					{ role: 'email', credentialId: 1 },
					{ role: 'refresh_token', credentialId: 2 },
				],
			});

			expect(result).toBe(7);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.set).toHaveBeenCalledWith(
				expect.objectContaining({ provider: 'gmail', config: {} }),
			);
			// delete + insert for credential links
			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith([
				{ integrationId: 7, role: 'email', credentialId: 1 },
				{ integrationId: 7, role: 'refresh_token', credentialId: 2 },
			]);
		});

		it('creates new integration when none exists (new→create path)', async () => {
			// Step 1: find existing integration → not found
			mockDb.chain.where.mockResolvedValueOnce([]);
			// Step 2a: insert integration — first values() call must return object with .returning()
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 15 }]);
			// Step 3: delete existing credential links → where
			mockDb.chain.where.mockResolvedValueOnce(undefined);
			// Step 4: insert credential links — second values() call is awaited directly (no .returning())
			// Use mockImplementation to make the second call return a resolved promise
			const originalValuesMock = mockDb.chain.values.getMockImplementation();
			let valuesCallCount = 0;
			mockDb.chain.values.mockImplementation((arg: unknown) => {
				valuesCallCount++;
				if (valuesCallCount === 1) {
					// First call: insert projectIntegrations → must return { returning }
					return { returning: mockDb.chain.returning };
				}
				// Second call: insert integrationCredentials → awaited directly
				return Promise.resolve(undefined);
			});

			const result = await upsertGmailIntegrationWithCredentials({
				projectId: 'proj2',
				credentialLinks: [{ role: 'email', credentialId: 3 }],
			});

			// Restore original implementation
			if (originalValuesMock) {
				mockDb.chain.values.mockImplementation(originalValuesMock);
			} else {
				mockDb.chain.values.mockReturnValue({ returning: mockDb.chain.returning });
			}

			expect(result).toBe(15);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
			expect(mockDb.db.update).not.toHaveBeenCalled();
			expect(mockDb.db.insert).toHaveBeenCalledTimes(2);
			// First insert: projectIntegrations
			expect(mockDb.chain.values).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({ projectId: 'proj2', category: 'email', provider: 'gmail' }),
			);
			// Second insert: integrationCredentials
			expect(mockDb.chain.values).toHaveBeenNthCalledWith(2, [
				{ integrationId: 15, role: 'email', credentialId: 3 },
			]);
		});
	});

	describe('getIntegrationProvider', () => {
		it('returns provider when integration is found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ provider: 'trello' }]);

			const result = await getIntegrationProvider('proj1', 'pm');

			expect(result).toBe('trello');
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});

		it('returns null when no integration found for category', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getIntegrationProvider('proj1', 'nonexistent');

			expect(result).toBeNull();
		});
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllProjectCredentials } from '../../../src/config/provider.js';
import { createCredential } from '../../../src/db/repositories/credentialsRepository.js';
import { truncateAll } from '../helpers/db.js';
import {
	seedCredential,
	seedIntegration,
	seedIntegrationCredential,
	seedOrg,
	seedProject,
} from '../helpers/seed.js';

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

		it('includes default org credentials (LLM API keys)', async () => {
			await seedCredential({
				orgId: 'test-org',
				envVarKey: 'OPENROUTER_API_KEY',
				value: 'or-key-secret',
				isDefault: true,
			});

			const creds = await getAllProjectCredentials('test-project');
			expect(creds.OPENROUTER_API_KEY).toBe('or-key-secret');
		});

		it('excludes non-default org credentials', async () => {
			await seedCredential({
				orgId: 'test-org',
				envVarKey: 'NON_DEFAULT_KEY',
				value: 'should-not-appear',
				isDefault: false,
			});

			const creds = await getAllProjectCredentials('test-project');
			expect(creds.NON_DEFAULT_KEY).toBeUndefined();
		});

		it('includes integration credentials mapped to env var keys', async () => {
			const apiKeyCred = await seedCredential({
				envVarKey: 'TRELLO_API_KEY',
				value: 'trello-api-key-value',
			});
			const tokenCred = await seedCredential({
				envVarKey: 'TRELLO_TOKEN',
				value: 'trello-token-value',
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

			const creds = await getAllProjectCredentials('test-project');
			expect(creds.TRELLO_API_KEY).toBe('trello-api-key-value');
			expect(creds.TRELLO_TOKEN).toBe('trello-token-value');
		});

		it('integration credentials override org default credentials', async () => {
			// Set up a default org credential for GITHUB_TOKEN_IMPLEMENTER
			await seedCredential({
				orgId: 'test-org',
				envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
				value: 'default-token',
				isDefault: true,
			});

			// Set up a project-specific integration credential
			const specificCred = await seedCredential({
				envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
				value: 'specific-token',
				name: 'Specific Implementer Token',
			});
			const integration = await seedIntegration({ category: 'scm', provider: 'github' });
			await seedIntegrationCredential({
				integrationId: integration.id,
				role: 'implementer_token',
				credentialId: specificCred.id,
			});

			const creds = await getAllProjectCredentials('test-project');
			// Integration credential should override org default
			expect(creds.GITHUB_TOKEN_IMPLEMENTER).toBe('specific-token');
		});

		it('includes both org defaults and integration credentials merged', async () => {
			// Org default for LLM
			await seedCredential({
				orgId: 'test-org',
				envVarKey: 'OPENROUTER_API_KEY',
				value: 'llm-key',
				isDefault: true,
			});

			// Integration credentials for SCM
			const ghCred = await seedCredential({
				envVarKey: 'GITHUB_TOKEN_IMPLEMENTER',
				value: 'gh-impl-token',
				name: 'GH Implementer',
			});
			const integration = await seedIntegration({ category: 'scm', provider: 'github' });
			await seedIntegrationCredential({
				integrationId: integration.id,
				role: 'implementer_token',
				credentialId: ghCred.id,
			});

			const creds = await getAllProjectCredentials('test-project');
			expect(creds.OPENROUTER_API_KEY).toBe('llm-key');
			expect(creds.GITHUB_TOKEN_IMPLEMENTER).toBe('gh-impl-token');
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

			const { id } = await createCredential({
				orgId: 'test-org',
				name: 'Encrypted LLM Key',
				envVarKey: 'OPENROUTER_API_KEY',
				value: 'plaintext-llm-secret',
				isDefault: true,
			});

			expect(id).toBeGreaterThan(0);

			// getAllProjectCredentials should transparently decrypt
			const creds = await getAllProjectCredentials('test-project');
			expect(creds.OPENROUTER_API_KEY).toBe('plaintext-llm-secret');
		});

		it('round-trips integration credentials through encrypt/decrypt', async () => {
			vi.stubEnv('CREDENTIAL_MASTER_KEY', 'c'.repeat(64));

			const cred = await createCredential({
				orgId: 'test-org',
				name: 'Encrypted Trello Key',
				envVarKey: 'TRELLO_API_KEY',
				value: 'encrypted-api-key',
			});
			const integration = await seedIntegration({ category: 'pm', provider: 'trello' });
			await seedIntegrationCredential({
				integrationId: integration.id,
				role: 'api_key',
				credentialId: cred.id,
			});

			const creds = await getAllProjectCredentials('test-project');
			expect(creds.TRELLO_API_KEY).toBe('encrypted-api-key');
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

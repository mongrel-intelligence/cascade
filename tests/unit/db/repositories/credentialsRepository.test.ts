import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '../../../helpers/mockDb.js';

// Mock the DB client
vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

import { getDb } from '../../../../src/db/client.js';
import {
	getIntegrationProvider,
	resolveAllProjectCredentials,
	resolveProjectCredential,
} from '../../../../src/db/repositories/credentialsRepository.js';

describe('credentialsRepository', () => {
	let mockDb: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		mockDb = createMockDb({ withDoubleJoin: true });
		vi.mocked(getDb).mockReturnValue(mockDb.db as never);
	});

	describe('resolveProjectCredential', () => {
		it('returns decrypted value when found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ value: 'ghp_impl_token' }]);

			const result = await resolveProjectCredential('proj1', 'GITHUB_TOKEN_IMPLEMENTER');
			expect(result).toBe('ghp_impl_token');
		});

		it('returns null when not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await resolveProjectCredential('proj1', 'MISSING_KEY');
			expect(result).toBeNull();
		});

		it('uses projectId as AAD for decryption when CREDENTIAL_MASTER_KEY is set', async () => {
			const key = randomBytes(32).toString('hex');
			vi.stubEnv('CREDENTIAL_MASTER_KEY', key);

			// Import encryptCredential to produce a valid encrypted value
			const { encryptCredential } = await import('../../../../src/db/crypto.js');
			const encryptedValue = encryptCredential('my-secret', 'proj1');
			mockDb.chain.where.mockResolvedValueOnce([{ value: encryptedValue }]);

			const result = await resolveProjectCredential('proj1', 'SOME_KEY');
			expect(result).toBe('my-secret');
		});
	});

	describe('resolveAllProjectCredentials', () => {
		it('returns all project credentials as key-value map', async () => {
			// First select: project existence check
			mockDb.chain.where.mockResolvedValueOnce([{ id: 'proj1' }]);
			// Second select: project_credentials rows
			mockDb.chain.where.mockResolvedValueOnce([
				{ envVarKey: 'GITHUB_TOKEN_IMPLEMENTER', value: 'ghp_impl' },
				{ envVarKey: 'TRELLO_API_KEY', value: 'trello-key' },
				{ envVarKey: 'OPENROUTER_API_KEY', value: 'or-key' },
			]);

			const result = await resolveAllProjectCredentials('proj1');
			expect(result).toEqual({
				GITHUB_TOKEN_IMPLEMENTER: 'ghp_impl',
				TRELLO_API_KEY: 'trello-key',
				OPENROUTER_API_KEY: 'or-key',
			});
		});

		it('returns empty object when no credentials', async () => {
			// Project exists
			mockDb.chain.where.mockResolvedValueOnce([{ id: 'proj1' }]);
			// No credentials
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await resolveAllProjectCredentials('proj1');
			expect(result).toEqual({});
		});

		it('throws when project not found', async () => {
			// Project does not exist
			mockDb.chain.where.mockResolvedValueOnce([]);

			await expect(resolveAllProjectCredentials('nonexistent')).rejects.toThrow(
				'Project not found: nonexistent',
			);
		});

		it('issues two queries: project existence check then project_credentials', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ id: 'proj1' }]);
			mockDb.chain.where.mockResolvedValueOnce([{ envVarKey: 'KEY1', value: 'val1' }]);

			await resolveAllProjectCredentials('proj1');

			// One select for project existence, one for project_credentials
			expect(mockDb.db.select).toHaveBeenCalledTimes(2);
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

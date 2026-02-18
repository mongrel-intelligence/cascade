import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the DB client
vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

import { getDb } from '../../../../src/db/client.js';
import {
	createCredential,
	deleteCredential,
	listOrgCredentials,
	listProjectOverrides,
	removeAgentCredentialOverride,
	removeProjectCredentialOverride,
	resolveAgentCredential,
	resolveAllCredentials,
	resolveCredential,
	setAgentCredentialOverride,
	setProjectCredentialOverride,
	updateCredential,
} from '../../../../src/db/repositories/credentialsRepository.js';

/**
 * Creates a mock Drizzle query chain that supports the common patterns:
 * select().from().where(), select().from().innerJoin().where(),
 * insert().values().returning(), insert().values().onConflictDoUpdate(),
 * update().set().where(), delete().from().where()
 */
function createMockDb() {
	const chain: Record<string, ReturnType<typeof vi.fn>> = {};

	// Terminal methods that return results
	chain.where = vi.fn().mockResolvedValue([]);
	chain.returning = vi.fn().mockResolvedValue([]);
	chain.onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);

	// Chain methods
	chain.innerJoin = vi.fn().mockReturnValue({ where: chain.where });
	chain.from = vi.fn().mockReturnValue({
		where: chain.where,
		innerJoin: chain.innerJoin,
	});
	chain.set = vi.fn().mockReturnValue({ where: chain.where });
	chain.values = vi.fn().mockReturnValue({
		returning: chain.returning,
		onConflictDoUpdate: chain.onConflictDoUpdate,
	});

	const db = {
		select: vi.fn().mockReturnValue({ from: chain.from }),
		insert: vi.fn().mockReturnValue({ values: chain.values }),
		update: vi.fn().mockReturnValue({ set: chain.set }),
		delete: vi.fn().mockReturnValue({ where: chain.where }),
	};

	return { db, chain };
}

describe('credentialsRepository', () => {
	let mockDb: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		mockDb = createMockDb();
		vi.mocked(getDb).mockReturnValue(mockDb.db as never);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.clearAllMocks();
	});

	describe('resolveCredential', () => {
		it('returns project override value when found', async () => {
			// First query (project override) returns a result
			mockDb.chain.where.mockResolvedValueOnce([{ value: 'project-override-secret' }]);

			const result = await resolveCredential('proj1', 'org1', 'GITHUB_TOKEN');
			expect(result).toBe('project-override-secret');

			// Should only call select once (found override, short-circuits)
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});

		it('falls back to org default when no project override', async () => {
			// First query (project override) returns empty
			mockDb.chain.where.mockResolvedValueOnce([]);
			// Second query (org default) returns a result
			mockDb.chain.where.mockResolvedValueOnce([{ value: 'org-default-secret' }]);

			const result = await resolveCredential('proj1', 'org1', 'GITHUB_TOKEN');
			expect(result).toBe('org-default-secret');

			// Two selects: override check + org default check
			expect(mockDb.db.select).toHaveBeenCalledTimes(2);
		});

		it('returns null when neither override nor org default exists', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await resolveCredential('proj1', 'org1', 'GITHUB_TOKEN');
			expect(result).toBeNull();
		});
	});

	describe('resolveAllCredentials', () => {
		it('merges org defaults with project overrides', async () => {
			// First query: org defaults
			mockDb.chain.where.mockResolvedValueOnce([
				{ envVarKey: 'GITHUB_TOKEN', value: 'org-gh-token' },
				{ envVarKey: 'TRELLO_API_KEY', value: 'org-trello-key' },
			]);
			// Second query: project overrides
			mockDb.chain.where.mockResolvedValueOnce([
				{ envVarKey: 'GITHUB_TOKEN', value: 'project-gh-token' },
			]);

			const result = await resolveAllCredentials('proj1', 'org1');
			expect(result).toEqual({
				GITHUB_TOKEN: 'project-gh-token', // override wins
				TRELLO_API_KEY: 'org-trello-key', // org default kept
			});
		});

		it('returns only org defaults when no overrides', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ envVarKey: 'KEY1', value: 'val1' }]);
			mockDb.chain.where.mockResolvedValueOnce([]); // no overrides

			const result = await resolveAllCredentials('proj1', 'org1');
			expect(result).toEqual({ KEY1: 'val1' });
		});

		it('returns empty when no credentials exist', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await resolveAllCredentials('proj1', 'org1');
			expect(result).toEqual({});
		});
	});

	describe('resolveAgentCredential', () => {
		it('returns agent-scoped override when found', async () => {
			// First query (agent override) returns a result
			mockDb.chain.where.mockResolvedValueOnce([{ value: 'agent-override-secret' }]);

			const result = await resolveAgentCredential('proj1', 'org1', 'review', 'GITHUB_TOKEN');
			expect(result).toBe('agent-override-secret');

			// Should only call select once (found agent override, short-circuits)
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});

		it('falls through to project override when no agent override', async () => {
			// First query (agent override) returns empty
			mockDb.chain.where.mockResolvedValueOnce([]);
			// Second query (project override via resolveCredential) returns a result
			mockDb.chain.where.mockResolvedValueOnce([{ value: 'project-override-secret' }]);

			const result = await resolveAgentCredential('proj1', 'org1', 'review', 'GITHUB_TOKEN');
			expect(result).toBe('project-override-secret');

			// Two selects: agent override check + project override check
			expect(mockDb.db.select).toHaveBeenCalledTimes(2);
		});

		it('falls through to org default when no agent or project override', async () => {
			// First query (agent override) returns empty
			mockDb.chain.where.mockResolvedValueOnce([]);
			// Second query (project override) returns empty
			mockDb.chain.where.mockResolvedValueOnce([]);
			// Third query (org default) returns a result
			mockDb.chain.where.mockResolvedValueOnce([{ value: 'org-default-secret' }]);

			const result = await resolveAgentCredential('proj1', 'org1', 'review', 'GITHUB_TOKEN');
			expect(result).toBe('org-default-secret');

			expect(mockDb.db.select).toHaveBeenCalledTimes(3);
		});

		it('returns null when no override at any level', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);
			mockDb.chain.where.mockResolvedValueOnce([]);
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await resolveAgentCredential('proj1', 'org1', 'review', 'GITHUB_TOKEN');
			expect(result).toBeNull();
		});
	});

	describe('setAgentCredentialOverride', () => {
		it('deletes then inserts agent-scoped override', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined); // delete
			mockDb.chain.returning.mockResolvedValueOnce([]); // insert (no returning needed)

			await setAgentCredentialOverride('proj1', 'GITHUB_TOKEN', 'review', 42);

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith({
				projectId: 'proj1',
				envVarKey: 'GITHUB_TOKEN',
				credentialId: 42,
				agentType: 'review',
			});
		});
	});

	describe('removeAgentCredentialOverride', () => {
		it('deletes agent-scoped override', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await removeAgentCredentialOverride('proj1', 'GITHUB_TOKEN', 'review');

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
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

	describe('setProjectCredentialOverride', () => {
		it('deletes then inserts project-wide override', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined); // delete

			await setProjectCredentialOverride('proj1', 'GITHUB_TOKEN', 42);

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith({
				projectId: 'proj1',
				envVarKey: 'GITHUB_TOKEN',
				credentialId: 42,
				agentType: null,
			});
		});
	});

	describe('removeProjectCredentialOverride', () => {
		it('deletes override for project and key', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await removeProjectCredentialOverride('proj1', 'GITHUB_TOKEN');

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});
	});

	describe('listProjectOverrides', () => {
		it('returns overrides with credential names', async () => {
			const mockOverrides = [
				{ envVarKey: 'GITHUB_TOKEN', credentialId: 42, credentialName: 'Bot Token' },
			];
			mockDb.chain.where.mockResolvedValueOnce(mockOverrides);

			const result = await listProjectOverrides('proj1');
			expect(result).toEqual(mockOverrides);
		});

		it('returns empty array when no overrides', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await listProjectOverrides('proj1');
			expect(result).toEqual([]);
		});
	});
});

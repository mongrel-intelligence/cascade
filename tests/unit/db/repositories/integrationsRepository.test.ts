import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '../../../helpers/mockDb.js';

vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

import { getDb } from '../../../../src/db/client.js';
import {
	deleteProjectIntegration,
	listIntegrationCredentials,
	listProjectIntegrations,
	removeIntegrationCredential,
	setIntegrationCredential,
	updateProjectIntegrationTriggers,
	upsertProjectIntegration,
} from '../../../../src/db/repositories/integrationsRepository.js';

describe('integrationsRepository', () => {
	let mockDb: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		mockDb = createMockDb({ withUpsert: true, withThenable: true });
		vi.mocked(getDb).mockReturnValue(mockDb.db as never);
	});

	describe('listProjectIntegrations', () => {
		it('returns integrations for project', async () => {
			const integrations = [
				{ id: 1, projectId: 'p1', category: 'pm', provider: 'trello', config: {}, triggers: {} },
			];
			mockDb.chain.where.mockResolvedValueOnce(integrations);

			const result = await listProjectIntegrations('p1');
			expect(result).toEqual(integrations);
		});
	});

	describe('upsertProjectIntegration', () => {
		it('upserts integration with onConflictDoUpdate', async () => {
			await upsertProjectIntegration('p1', 'pm', 'trello', { boardId: 'abc' }, {});

			expect(mockDb.db.delete).not.toHaveBeenCalled();
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith({
				projectId: 'p1',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'abc' },
				triggers: {},
			});
			expect(mockDb.chain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
		});

		it('preserves existing triggers when triggers not provided', async () => {
			// Mock getIntegrationByProjectAndCategory to return existing integration with triggers
			mockDb.chain.where.mockResolvedValueOnce([
				{
					id: 1,
					projectId: 'p1',
					category: 'pm',
					provider: 'trello',
					config: {},
					triggers: { cardMovedToBriefing: true, cardMovedToPlanning: false },
				},
			]); // getIntegrationByProjectAndCategory

			await upsertProjectIntegration('p1', 'pm', 'trello', { boardId: 'xyz' });

			expect(mockDb.db.select).toHaveBeenCalledTimes(1); // getIntegrationByProjectAndCategory
			expect(mockDb.db.delete).not.toHaveBeenCalled();
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith({
				projectId: 'p1',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'xyz' },
				triggers: { cardMovedToBriefing: true, cardMovedToPlanning: false },
			});
			expect(mockDb.chain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
		});

		it('preserves integration id on update (no delete)', async () => {
			await upsertProjectIntegration('p1', 'scm', 'github', { repo: 'owner/repo' }, {});

			expect(mockDb.db.delete).not.toHaveBeenCalled();
			expect(mockDb.chain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
		});
	});

	describe('deleteProjectIntegration', () => {
		it('deletes integration by projectId and type', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteProjectIntegration('p1', 'trello');

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});
	});

	describe('updateProjectIntegrationTriggers', () => {
		it('deep-merges triggers with existing ones on success', async () => {
			// getIntegrationByProjectAndCategory: find existing integration
			mockDb.chain.where.mockResolvedValueOnce([
				{
					id: 1,
					projectId: 'p1',
					category: 'pm',
					provider: 'trello',
					config: {},
					triggers: {
						cardMovedToBriefing: true,
						nested: { keyA: 'a', keyB: 'b' },
					},
				},
			]);
			// update().set().where() call
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateProjectIntegrationTriggers('p1', 'pm', {
				cardMovedToPlanning: false,
				nested: { keyB: 'overridden', keyC: 'c' },
			});

			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.set).toHaveBeenCalledWith(
				expect.objectContaining({
					triggers: {
						cardMovedToBriefing: true,
						cardMovedToPlanning: false,
						nested: { keyA: 'a', keyB: 'overridden', keyC: 'c' },
					},
				}),
			);
		});

		it('throws an error when no integration is found for project+category', async () => {
			// getIntegrationByProjectAndCategory: not found
			mockDb.chain.where.mockResolvedValueOnce([]);

			await expect(
				updateProjectIntegrationTriggers('p-missing', 'pm', { someTrigger: true }),
			).rejects.toThrow('No pm integration found for project p-missing');

			expect(mockDb.db.update).not.toHaveBeenCalled();
		});

		it('merges top-level scalar triggers without overwriting unrelated keys', async () => {
			mockDb.chain.where.mockResolvedValueOnce([
				{
					id: 2,
					projectId: 'p2',
					category: 'scm',
					provider: 'github',
					config: {},
					triggers: { prOpened: true, checkSuiteSuccess: false },
				},
			]);
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateProjectIntegrationTriggers('p2', 'scm', { checkSuiteSuccess: true });

			expect(mockDb.chain.set).toHaveBeenCalledWith(
				expect.objectContaining({
					triggers: { prOpened: true, checkSuiteSuccess: true },
				}),
			);
		});
	});

	describe('listIntegrationCredentials', () => {
		it('returns credentials linked to the integration with join', async () => {
			const mockRows = [
				{ id: 1, role: 'api_key', credentialId: 10, credentialName: 'Trello Key' },
				{ id: 2, role: 'token', credentialId: 11, credentialName: 'Trello Token' },
			];
			// The query is select().from().innerJoin().where()
			mockDb.chain.where.mockResolvedValueOnce(mockRows);

			const result = await listIntegrationCredentials(42);

			expect(result).toEqual(mockRows);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.innerJoin).toHaveBeenCalledTimes(1);
		});

		it('returns empty array when no credentials linked', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await listIntegrationCredentials(99);

			expect(result).toEqual([]);
		});
	});

	describe('setIntegrationCredential', () => {
		it('deletes existing role entry then inserts new one', async () => {
			// delete().where() call
			mockDb.chain.where.mockResolvedValueOnce(undefined);
			// insert().values() — needs to be thenable
			mockDb.chain.values.mockResolvedValueOnce(undefined);

			await setIntegrationCredential(5, 'api_key', 20);

			// delete the existing role
			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
			// insert the new credential link
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith({
				integrationId: 5,
				role: 'api_key',
				credentialId: 20,
			});
		});

		it('handles setting credential when no prior entry exists', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);
			mockDb.chain.values.mockResolvedValueOnce(undefined);

			await setIntegrationCredential(7, 'token', 30);

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
		});
	});

	describe('removeIntegrationCredential', () => {
		it('deletes the credential link by integrationId and role', async () => {
			// Initial select for project info (no integration found — skips cleanup)
			mockDb.chain.where.mockResolvedValueOnce([]);
			// delete().where()
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await removeIntegrationCredential(5, 'api_key');

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});

		it('does not throw when no entry exists to remove', async () => {
			// Initial select for project info
			mockDb.chain.where.mockResolvedValueOnce([]);
			// delete().where()
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await expect(removeIntegrationCredential(99, 'nonexistent_role')).resolves.toBeUndefined();
			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});
	});
});

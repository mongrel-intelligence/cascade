import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

import {
	deleteProjectIntegration,
	listProjectIntegrations,
	removeIntegrationCredential,
	updateProjectIntegrationTriggers,
	upsertProjectIntegration,
} from '../../../../src/db/repositories/integrationsRepository.js';

describe('integrationsRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb({ withUpsert: true, withThenable: true });
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

	describe('removeIntegrationCredential', () => {
		it('looks up integration and deletes from project_credentials when envVarKey found', async () => {
			// Select integration info
			mockDb.chain.where.mockResolvedValueOnce([{ projectId: 'p1', provider: 'trello' }]);
			// delete().where() for project_credentials
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await removeIntegrationCredential(5, 'api_key');

			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});

		it('does not delete when no integration found', async () => {
			// No integration found
			mockDb.chain.where.mockResolvedValueOnce([]);

			await expect(removeIntegrationCredential(99, 'nonexistent_role')).resolves.toBeUndefined();
			expect(mockDb.db.delete).not.toHaveBeenCalled();
		});
	});
});

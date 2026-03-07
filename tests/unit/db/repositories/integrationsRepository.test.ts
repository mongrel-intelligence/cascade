import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '../../../helpers/mockDb.js';

vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

import { getDb } from '../../../../src/db/client.js';
import {
	deleteProjectIntegration,
	getAllProjectIdsWithEmailIntegration,
	getAllProjectIdsWithSmsIntegration,
	listProjectIntegrations,
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

	describe('getAllProjectIdsWithEmailIntegration', () => {
		it('returns projectIds for all email integrations', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ projectId: 'proj-1' }, { projectId: 'proj-2' }]);

			const result = await getAllProjectIdsWithEmailIntegration();

			expect(result).toEqual(['proj-1', 'proj-2']);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});

		it('returns empty array when no email integrations exist', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getAllProjectIdsWithEmailIntegration();

			expect(result).toEqual([]);
		});
	});

	describe('getAllProjectIdsWithSmsIntegration', () => {
		it('returns projectIds for all SMS integrations', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ projectId: 'proj-3' }, { projectId: 'proj-4' }]);

			const result = await getAllProjectIdsWithSmsIntegration();

			expect(result).toEqual(['proj-3', 'proj-4']);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});

		it('returns empty array when no SMS integrations exist', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getAllProjectIdsWithSmsIntegration();

			expect(result).toEqual([]);
		});
	});
});

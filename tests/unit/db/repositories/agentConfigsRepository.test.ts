import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '../../../helpers/mockDb.js';

vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

import { getDb } from '../../../../src/db/client.js';
import {
	createAgentConfig,
	deleteAgentConfig,
	getMaxConcurrency,
	listAgentConfigs,
	updateAgentConfig,
} from '../../../../src/db/repositories/agentConfigsRepository.js';

describe('agentConfigsRepository', () => {
	let mockDb: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		mockDb = createMockDb({ withUpsert: true, withThenable: true, withLimit: true });
		vi.mocked(getDb).mockReturnValue(mockDb.db as never);
		// Reset cache for getMaxConcurrency by clearing the internal map if it were accessible
		// Since it's private to the module, we rely on unique projectIds or clearing it somehow.
		// For now we'll just use fresh IDs.
	});

	describe('listAgentConfigs', () => {
		it('returns all configs when no filter', async () => {
			const configs = [{ id: 1, agentType: 'impl' }];
			// No where clause → thenable chain resolves
			const fromMock = vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(configs),
				// biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for Drizzle query chains
				then: (resolve: (v: unknown) => unknown) => Promise.resolve(configs).then(resolve),
			});
			mockDb.db.select.mockReturnValue({ from: fromMock });

			const result = await listAgentConfigs();
			expect(result).toEqual(configs);
		});

		it('filters by projectId when provided', async () => {
			const configs = [{ id: 2, agentType: 'review', projectId: 'p1' }];
			mockDb.chain.where.mockResolvedValueOnce(configs);

			const result = await listAgentConfigs({ projectId: 'p1' });
			expect(result).toEqual(configs);
		});

		it('filters by projectId and includes fallbacks when orgId provided', async () => {
			const configs = [{ id: 2, agentType: 'review', projectId: 'p1' }];
			mockDb.chain.where.mockResolvedValueOnce(configs);

			const result = await listAgentConfigs({ projectId: 'p1', orgId: 'org-1' });
			expect(result).toEqual(configs);
		});

		it('filters to non-project configs when orgId provided', async () => {
			const configs = [{ id: 3, agentType: 'impl', orgId: 'org-1' }];
			mockDb.chain.where.mockResolvedValueOnce(configs);

			const result = await listAgentConfigs({ orgId: 'org-1' });
			expect(result).toEqual(configs);
		});
	});

	describe('createAgentConfig', () => {
		it('inserts config and returns id', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 42 }]);

			const result = await createAgentConfig({
				orgId: 'org-1',
				agentType: 'implementation',
				model: 'test-model',
				maxIterations: 20,
			});

			expect(result).toEqual({ id: 42 });
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					orgId: 'org-1',
					projectId: null,
					agentType: 'implementation',
					model: 'test-model',
					maxIterations: 20,
				}),
			);
		});
	});

	describe('updateAgentConfig', () => {
		it('updates config fields', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateAgentConfig(42, { model: 'new-model', maxIterations: 30 });

			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.model).toBe('new-model');
			expect(setArg.maxIterations).toBe(30);
			expect(setArg.updatedAt).toBeInstanceOf(Date);
		});
	});

	describe('deleteAgentConfig', () => {
		it('deletes config by id', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await deleteAgentConfig(42);

			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});
	});

	describe('getMaxConcurrency', () => {
		it('returns project-scoped limit if set', async () => {
			mockDb.chain.limit.mockResolvedValueOnce([{ maxConcurrency: 5 }]);
			const result = await getMaxConcurrency('p-proj-1', 'implementation');
			expect(result).toBe(5);
		});

		it('falls back to org-scoped limit if project-scoped is not set', async () => {
			// First call (project-scoped): return empty
			mockDb.chain.limit.mockResolvedValueOnce([]);
			// Second call (fetch orgId from project): return org-1
			mockDb.chain.limit.mockResolvedValueOnce([{ orgId: 'org-1' }]);
			// Third call (org-scoped): return limit 3
			mockDb.chain.limit.mockResolvedValueOnce([{ maxConcurrency: 3 }]);

			const result = await getMaxConcurrency('p-proj-2', 'implementation');
			expect(result).toBe(3);
		});

		it('falls back to global-scoped limit if org-scoped is not set', async () => {
			// First call (project-scoped): return empty
			mockDb.chain.limit.mockResolvedValueOnce([]);
			// Second call (fetch orgId from project): return org-1
			mockDb.chain.limit.mockResolvedValueOnce([{ orgId: 'org-1' }]);
			// Third call (org-scoped): return empty
			mockDb.chain.limit.mockResolvedValueOnce([]);
			// Fourth call (global-scoped): return limit 2
			mockDb.chain.limit.mockResolvedValueOnce([{ maxConcurrency: 2 }]);

			const result = await getMaxConcurrency('p-proj-3', 'implementation');
			expect(result).toBe(2);
		});
	});
});

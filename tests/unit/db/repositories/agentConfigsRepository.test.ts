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
	});

	describe('listAgentConfigs', () => {
		it('filters by projectId', async () => {
			const configs = [{ id: 2, agentType: 'review', projectId: 'p1' }];
			mockDb.chain.where.mockResolvedValueOnce(configs);

			const result = await listAgentConfigs({ projectId: 'p1' });
			expect(result).toEqual(configs);
		});
	});

	describe('createAgentConfig', () => {
		it('inserts config and returns id', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 42 }]);

			const result = await createAgentConfig({
				projectId: 'proj-1',
				agentType: 'implementation',
				model: 'test-model',
				maxIterations: 20,
			});

			expect(result).toEqual({ id: 42 });
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-1',
					agentType: 'implementation',
					model: 'test-model',
					maxIterations: 20,
				}),
			);
		});

		it('persists engineSettings when provided', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 43 }]);
			const engineSettings = { 'claude-code': { maxThinkingTokens: 8000 } };

			const result = await createAgentConfig({
				projectId: 'proj-1',
				agentType: 'implementation',
				engineSettings,
			});

			expect(result).toEqual({ id: 43 });
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					agentEngineSettings: engineSettings,
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

		it('persists engineSettings when provided', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);
			const engineSettings = { codex: { sandboxMode: 'workspace-write' } };

			await updateAgentConfig(42, { engineSettings });

			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.agentEngineSettings).toEqual(engineSettings);
			expect(setArg.updatedAt).toBeInstanceOf(Date);
		});

		it('does not set agentEngineSettings when engineSettings is not provided', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateAgentConfig(42, { model: 'updated-model' });

			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(Object.hasOwn(setArg, 'agentEngineSettings')).toBe(false);
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

		it('returns null when no project config found', async () => {
			// Only one DB call now (no org/global fallback)
			mockDb.chain.limit.mockResolvedValueOnce([]);

			const result = await getMaxConcurrency('p-proj-unique-1', 'implementation');
			expect(result).toBeNull();
		});

		it('returns null when project config has no maxConcurrency', async () => {
			mockDb.chain.limit.mockResolvedValueOnce([{ maxConcurrency: null }]);

			const result = await getMaxConcurrency('p-proj-unique-2', 'review');
			expect(result).toBeNull();
		});
	});
});

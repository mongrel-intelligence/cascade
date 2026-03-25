import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

import {
	createAgentConfig,
	deleteAgentConfig,
	getAgentConfigPrompts,
	getMaxConcurrency,
	listAgentConfigs,
	listDistinctEnginesByProject,
	updateAgentConfig,
} from '../../../../src/db/repositories/agentConfigsRepository.js';

describe('agentConfigsRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb({ withUpsert: true, withThenable: true, withLimit: true });
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

		it('persists systemPrompt and taskPrompt when provided', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 44 }]);

			const result = await createAgentConfig({
				projectId: 'proj-1',
				agentType: 'implementation',
				systemPrompt: 'You are a helpful assistant.',
				taskPrompt: 'Focus on clean code.',
			});

			expect(result).toEqual({ id: 44 });
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					systemPrompt: 'You are a helpful assistant.',
					taskPrompt: 'Focus on clean code.',
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

		it('persists systemPrompt and taskPrompt when provided', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateAgentConfig(42, {
				systemPrompt: 'Updated system prompt.',
				taskPrompt: 'Updated task prompt.',
			});

			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.systemPrompt).toBe('Updated system prompt.');
			expect(setArg.taskPrompt).toBe('Updated task prompt.');
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

	describe('getAgentConfigPrompts', () => {
		it('returns systemPrompt and taskPrompt when set', async () => {
			mockDb.chain.limit.mockResolvedValueOnce([
				{ systemPrompt: 'Custom system prompt.', taskPrompt: 'Custom task prompt.' },
			]);

			const result = await getAgentConfigPrompts('prompts-proj-1', 'implementation');

			expect(result).toEqual({
				systemPrompt: 'Custom system prompt.',
				taskPrompt: 'Custom task prompt.',
			});
		});

		it('returns null for both prompts when no config found', async () => {
			mockDb.chain.limit.mockResolvedValueOnce([]);

			const result = await getAgentConfigPrompts('prompts-proj-unique-1', 'review');

			expect(result).toEqual({ systemPrompt: null, taskPrompt: null });
		});

		it('returns null for individual prompts when not set', async () => {
			mockDb.chain.limit.mockResolvedValueOnce([{ systemPrompt: null, taskPrompt: null }]);

			const result = await getAgentConfigPrompts('prompts-proj-unique-2', 'splitting');

			expect(result).toEqual({ systemPrompt: null, taskPrompt: null });
		});
	});

	describe('listDistinctEnginesByProject', () => {
		it('returns distinct engine IDs for a project', async () => {
			mockDb.chain.where.mockResolvedValueOnce([
				{ agentEngine: 'codex' },
				{ agentEngine: 'claude-code' },
			]);

			const result = await listDistinctEnginesByProject('proj-engines-1');

			expect(result).toEqual(['codex', 'claude-code']);
		});

		it('returns empty array when no agent configs have engine overrides', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await listDistinctEnginesByProject('proj-engines-2');

			expect(result).toEqual([]);
		});

		it('returns a single engine when all agent configs use the same engine', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ agentEngine: 'opencode' }]);

			const result = await listDistinctEnginesByProject('proj-engines-3');

			expect(result).toEqual(['opencode']);
		});

		it('uses selectDistinct on the agentConfigs table', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			await listDistinctEnginesByProject('proj-engines-4');

			// selectDistinct is called (not select) — verify through the mock db
			expect(mockDb.db.selectDistinct).toHaveBeenCalledTimes(1);
		});
	});
});

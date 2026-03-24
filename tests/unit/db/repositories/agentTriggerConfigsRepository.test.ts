import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

import {
	bulkUpsertTriggerConfigs,
	deleteTriggerConfig,
	deleteTriggerConfigsByProject,
	getTriggerConfig,
	getTriggerConfigById,
	getTriggerConfigsByProject,
	getTriggerConfigsByProjectAndAgent,
	updateTriggerConfig,
	upsertTriggerConfig,
} from '../../../../src/db/repositories/agentTriggerConfigsRepository.js';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const now = new Date('2024-01-01T00:00:00.000Z');

const dbRow = {
	id: 1,
	projectId: 'proj-1',
	agentType: 'implementation',
	triggerEvent: 'pm:status-changed',
	enabled: true,
	parameters: { targetList: 'todo' },
	createdAt: now,
	updatedAt: now,
};

const expectedConfig = {
	id: 1,
	projectId: 'proj-1',
	agentType: 'implementation',
	triggerEvent: 'pm:status-changed',
	enabled: true,
	parameters: { targetList: 'todo' },
	createdAt: now,
	updatedAt: now,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agentTriggerConfigsRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb({ withUpsert: true });
	});

	// -------------------------------------------------------------------------
	// getTriggerConfigById
	// -------------------------------------------------------------------------

	describe('getTriggerConfigById', () => {
		it('returns mapped config when row is found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([dbRow]);

			const result = await getTriggerConfigById(1);

			expect(result).toEqual(expectedConfig);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});

		it('returns null when no row is found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getTriggerConfigById(999);

			expect(result).toBeNull();
		});
	});

	// -------------------------------------------------------------------------
	// getTriggerConfig (composite key lookup)
	// -------------------------------------------------------------------------

	describe('getTriggerConfig', () => {
		it('returns mapped config for matching projectId + agentType + triggerEvent', async () => {
			mockDb.chain.where.mockResolvedValueOnce([dbRow]);

			const result = await getTriggerConfig('proj-1', 'implementation', 'pm:status-changed');

			expect(result).toEqual(expectedConfig);
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});

		it('returns null when no matching composite key exists', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getTriggerConfig('proj-1', 'review', 'scm:check-suite-success');

			expect(result).toBeNull();
		});
	});

	// -------------------------------------------------------------------------
	// getTriggerConfigsByProject
	// -------------------------------------------------------------------------

	describe('getTriggerConfigsByProject', () => {
		it('returns all configs for a project', async () => {
			const row2 = {
				...dbRow,
				id: 2,
				agentType: 'review',
				triggerEvent: 'scm:check-suite-success',
			};
			mockDb.chain.where.mockResolvedValueOnce([dbRow, row2]);

			const result = await getTriggerConfigsByProject('proj-1');

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual(expectedConfig);
			expect(result[1]).toEqual(
				expect.objectContaining({
					id: 2,
					agentType: 'review',
					triggerEvent: 'scm:check-suite-success',
				}),
			);
		});

		it('returns empty array when project has no configs', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getTriggerConfigsByProject('proj-none');

			expect(result).toEqual([]);
		});
	});

	// -------------------------------------------------------------------------
	// getTriggerConfigsByProjectAndAgent
	// -------------------------------------------------------------------------

	describe('getTriggerConfigsByProjectAndAgent', () => {
		it('returns all configs for a specific agent in a project', async () => {
			const row2 = {
				...dbRow,
				id: 2,
				triggerEvent: 'scm:check-suite-success',
			};
			mockDb.chain.where.mockResolvedValueOnce([dbRow, row2]);

			const result = await getTriggerConfigsByProjectAndAgent('proj-1', 'implementation');

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual(expectedConfig);
			expect(result[1]).toEqual(
				expect.objectContaining({
					id: 2,
					agentType: 'implementation',
					triggerEvent: 'scm:check-suite-success',
				}),
			);
		});

		it('returns empty array when no configs exist for the agent type', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getTriggerConfigsByProjectAndAgent('proj-1', 'nonexistent');

			expect(result).toEqual([]);
		});
	});

	// -------------------------------------------------------------------------
	// upsertTriggerConfig - create path (no conflict)
	// -------------------------------------------------------------------------

	describe('upsertTriggerConfig - create path', () => {
		it('inserts and returns mapped config with default enabled=true and parameters={}', async () => {
			const insertedRow = {
				id: 5,
				projectId: 'proj-2',
				agentType: 'splitting',
				triggerEvent: 'pm:label-added',
				enabled: true,
				parameters: {},
				createdAt: now,
				updatedAt: now,
			};
			mockDb.chain.returning.mockResolvedValueOnce([insertedRow]);

			const result = await upsertTriggerConfig({
				projectId: 'proj-2',
				agentType: 'splitting',
				triggerEvent: 'pm:label-added',
			});

			expect(result).toEqual({
				id: 5,
				projectId: 'proj-2',
				agentType: 'splitting',
				triggerEvent: 'pm:label-added',
				enabled: true,
				parameters: {},
				createdAt: now,
				updatedAt: now,
			});
			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-2',
					agentType: 'splitting',
					triggerEvent: 'pm:label-added',
					enabled: true,
					parameters: {},
				}),
			);
		});

		it('inserts with explicit enabled and parameters values', async () => {
			const insertedRow = {
				id: 6,
				projectId: 'proj-2',
				agentType: 'review',
				triggerEvent: 'scm:check-suite-success',
				enabled: false,
				parameters: { authorMode: 'own' },
				createdAt: now,
				updatedAt: now,
			};
			mockDb.chain.returning.mockResolvedValueOnce([insertedRow]);

			const result = await upsertTriggerConfig({
				projectId: 'proj-2',
				agentType: 'review',
				triggerEvent: 'scm:check-suite-success',
				enabled: false,
				parameters: { authorMode: 'own' },
			});

			expect(result.enabled).toBe(false);
			expect(result.parameters).toEqual({ authorMode: 'own' });
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					enabled: false,
					parameters: { authorMode: 'own' },
				}),
			);
		});
	});

	// -------------------------------------------------------------------------
	// updateTriggerConfig
	// -------------------------------------------------------------------------

	describe('updateTriggerConfig', () => {
		it('updates enabled field and returns mapped config', async () => {
			const updatedRow = { ...dbRow, enabled: false, updatedAt: new Date() };

			// updateTriggerConfig uses .update().set().where().returning()
			// The default mock chain has .where() as a terminal; we need to override
			// the set() mock to return a where-then-returning chain.
			const returningMock = vi.fn().mockResolvedValueOnce([updatedRow]);
			const whereWithReturning = vi.fn().mockReturnValue({ returning: returningMock });
			mockDb.chain.set.mockReturnValueOnce({ where: whereWithReturning });

			const result = await updateTriggerConfig(1, { enabled: false });

			expect(result).not.toBeNull();
			expect(result?.enabled).toBe(false);
			expect(mockDb.db.update).toHaveBeenCalledTimes(1);
			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.enabled).toBe(false);
			expect(setArg.updatedAt).toBeInstanceOf(Date);
		});

		it('updates parameters field and returns mapped config', async () => {
			const updatedRow = { ...dbRow, parameters: { newKey: 'newVal' }, updatedAt: new Date() };

			const returningMock = vi.fn().mockResolvedValueOnce([updatedRow]);
			const whereWithReturning = vi.fn().mockReturnValue({ returning: returningMock });
			mockDb.chain.set.mockReturnValueOnce({ where: whereWithReturning });

			const result = await updateTriggerConfig(1, { parameters: { newKey: 'newVal' } });

			expect(result).not.toBeNull();
			expect(result?.parameters).toEqual({ newKey: 'newVal' });
			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.parameters).toEqual({ newKey: 'newVal' });
		});

		it('returns null when row not found', async () => {
			const returningMock = vi.fn().mockResolvedValueOnce([]);
			const whereWithReturning = vi.fn().mockReturnValue({ returning: returningMock });
			mockDb.chain.set.mockReturnValueOnce({ where: whereWithReturning });

			const result = await updateTriggerConfig(999, { enabled: true });

			expect(result).toBeNull();
		});
	});

	// -------------------------------------------------------------------------
	// upsertTriggerConfig (conflict resolution)
	// -------------------------------------------------------------------------

	describe('upsertTriggerConfig', () => {
		it('creates new config when no conflict', async () => {
			const newRow = {
				id: 10,
				projectId: 'proj-3',
				agentType: 'planning',
				triggerEvent: 'pm:status-changed',
				enabled: true,
				parameters: {},
				createdAt: now,
				updatedAt: now,
			};
			mockDb.chain.returning.mockResolvedValueOnce([newRow]);

			const result = await upsertTriggerConfig({
				projectId: 'proj-3',
				agentType: 'planning',
				triggerEvent: 'pm:status-changed',
			});

			expect(result.id).toBe(10);
			expect(result.enabled).toBe(true);
			expect(mockDb.chain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
		});

		it('updates existing config on conflict', async () => {
			const updatedRow = {
				...dbRow,
				enabled: false,
				parameters: { authorMode: 'external' },
				updatedAt: new Date(),
			};
			mockDb.chain.returning.mockResolvedValueOnce([updatedRow]);

			const result = await upsertTriggerConfig({
				projectId: 'proj-1',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: false,
				parameters: { authorMode: 'external' },
			});

			expect(result.enabled).toBe(false);
			expect(result.parameters).toEqual({ authorMode: 'external' });
			expect(mockDb.chain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
			const conflictArg = mockDb.chain.onConflictDoUpdate.mock.calls[0][0];
			expect(conflictArg.set).toMatchObject({
				enabled: false,
				parameters: { authorMode: 'external' },
			});
		});
	});

	// -------------------------------------------------------------------------
	// deleteTriggerConfig
	// -------------------------------------------------------------------------

	describe('deleteTriggerConfig', () => {
		it('returns true when a row is deleted', async () => {
			mockDb.chain.where.mockResolvedValueOnce({ rowCount: 1 });

			const result = await deleteTriggerConfig(1);

			expect(result).toBe(true);
			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});

		it('returns false when no row is deleted (not found)', async () => {
			mockDb.chain.where.mockResolvedValueOnce({ rowCount: 0 });

			const result = await deleteTriggerConfig(999);

			expect(result).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// deleteTriggerConfigsByProject
	// -------------------------------------------------------------------------

	describe('deleteTriggerConfigsByProject', () => {
		it('returns count of deleted rows when configs are deleted', async () => {
			mockDb.chain.where.mockResolvedValueOnce({ rowCount: 3 });

			const result = await deleteTriggerConfigsByProject('proj-1');

			expect(result).toBe(3);
			expect(mockDb.db.delete).toHaveBeenCalledTimes(1);
		});

		it('returns 0 when no configs exist for the project', async () => {
			mockDb.chain.where.mockResolvedValueOnce({ rowCount: 0 });

			const result = await deleteTriggerConfigsByProject('proj-none');

			expect(result).toBe(0);
		});
	});

	// -------------------------------------------------------------------------
	// bulkUpsertTriggerConfigs (tests bulkGetTriggerConfigs-like bulk operations)
	// -------------------------------------------------------------------------

	describe('bulkUpsertTriggerConfigs', () => {
		it('returns empty array for empty input', async () => {
			const result = await bulkUpsertTriggerConfigs([]);
			expect(result).toEqual([]);
			expect(mockDb.db.insert).not.toHaveBeenCalled();
		});

		it('upserts multiple configs and returns mapped results', async () => {
			const row1 = { ...dbRow, id: 1 };
			const row2 = {
				...dbRow,
				id: 2,
				agentType: 'review',
				triggerEvent: 'scm:check-suite-success',
			};

			// bulkUpsertTriggerConfigs uses a transaction; mock the transaction
			const txChain: Record<string, ReturnType<typeof vi.fn>> = {};
			txChain.returning = vi.fn();
			txChain.returning.mockResolvedValueOnce([row1]).mockResolvedValueOnce([row2]);
			txChain.onConflictDoUpdate = vi.fn().mockReturnValue({ returning: txChain.returning });
			txChain.values = vi.fn().mockReturnValue({ onConflictDoUpdate: txChain.onConflictDoUpdate });
			const txInsert = vi.fn().mockReturnValue({ values: txChain.values });
			const tx = { insert: txInsert };

			// Override db.transaction to call the callback with the tx object
			(mockDb.db as unknown as Record<string, unknown>).transaction = vi
				.fn()
				.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
					await fn(tx);
				});

			const result = await bulkUpsertTriggerConfigs([
				{ projectId: 'proj-1', agentType: 'implementation', triggerEvent: 'pm:status-changed' },
				{ projectId: 'proj-1', agentType: 'review', triggerEvent: 'scm:check-suite-success' },
			]);

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual(expect.objectContaining({ id: 1, agentType: 'implementation' }));
			expect(result[1]).toEqual(expect.objectContaining({ id: 2, agentType: 'review' }));
			expect(txInsert).toHaveBeenCalledTimes(2);
		});
	});

	// -------------------------------------------------------------------------
	// mapRowToConfig (tested implicitly through the functions above; this
	// section tests specific mapping edge cases)
	// -------------------------------------------------------------------------

	describe('mapRowToConfig helper (via getTriggerConfigById)', () => {
		it('maps null parameters to empty object', async () => {
			const rowWithNullParams = { ...dbRow, parameters: null };
			mockDb.chain.where.mockResolvedValueOnce([rowWithNullParams]);

			const result = await getTriggerConfigById(1);

			expect(result?.parameters).toEqual({});
		});

		it('maps all DB fields correctly to AgentTriggerConfig interface', async () => {
			const fullRow = {
				id: 42,
				projectId: 'my-project',
				agentType: 'review',
				triggerEvent: 'scm:pr-opened',
				enabled: false,
				parameters: { key: 'value' },
				createdAt: now,
				updatedAt: now,
			};
			mockDb.chain.where.mockResolvedValueOnce([fullRow]);

			const result = await getTriggerConfigById(42);

			expect(result).toEqual({
				id: 42,
				projectId: 'my-project',
				agentType: 'review',
				triggerEvent: 'scm:pr-opened',
				enabled: false,
				parameters: { key: 'value' },
				createdAt: now,
				updatedAt: now,
			});
		});
	});
});

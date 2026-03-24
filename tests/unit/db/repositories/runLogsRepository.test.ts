import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

vi.mock('../../../../src/db/schema/index.js', () => ({
	agentRunLogs: {
		id: 'id',
		runId: 'run_id',
		cascadeLog: 'cascade_log',
		engineLog: 'engine_log',
		createdAt: 'created_at',
	},
}));

import { getRunLogs, storeRunLogs } from '../../../../src/db/repositories/runLogsRepository.js';

describe('runLogsRepository', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	beforeEach(() => {
		mockDb = createMockDbWithGetDb();
	});

	describe('storeRunLogs', () => {
		it('inserts run logs with cascade and engine log', async () => {
			mockDb.chain.values.mockResolvedValueOnce(undefined);

			await storeRunLogs('run-1', 'cascade log text', 'engine log text');

			expect(mockDb.db.insert).toHaveBeenCalled();
			expect(mockDb.chain.values).toHaveBeenCalledWith({
				runId: 'run-1',
				cascadeLog: 'cascade log text',
				engineLog: 'engine log text',
			});
		});

		it('stores null when cascadeLog is undefined (null coalescing)', async () => {
			mockDb.chain.values.mockResolvedValueOnce(undefined);

			await storeRunLogs('run-1');

			expect(mockDb.chain.values).toHaveBeenCalledWith({
				runId: 'run-1',
				cascadeLog: null,
				engineLog: null,
			});
		});

		it('stores null for undefined engineLog only', async () => {
			mockDb.chain.values.mockResolvedValueOnce(undefined);

			await storeRunLogs('run-1', 'cascade log');

			expect(mockDb.chain.values).toHaveBeenCalledWith({
				runId: 'run-1',
				cascadeLog: 'cascade log',
				engineLog: null,
			});
		});

		it('stores null for undefined cascadeLog only', async () => {
			mockDb.chain.values.mockResolvedValueOnce(undefined);

			await storeRunLogs('run-1', undefined, 'engine log');

			expect(mockDb.chain.values).toHaveBeenCalledWith({
				runId: 'run-1',
				cascadeLog: null,
				engineLog: 'engine log',
			});
		});
	});

	describe('getRunLogs', () => {
		it('returns run logs when found', async () => {
			const mockLogs = {
				id: 'log-1',
				runId: 'run-1',
				cascadeLog: 'log content',
				engineLog: 'engine content',
			};
			mockDb.chain.where.mockResolvedValueOnce([mockLogs]);

			const result = await getRunLogs('run-1');

			expect(result).toEqual(mockLogs);
			expect(mockDb.db.select).toHaveBeenCalled();
		});

		it('returns null when no logs found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getRunLogs('nonexistent-run');

			expect(result).toBeNull();
		});

		it('returns logs with null cascadeLog (optional field)', async () => {
			const mockLogs = {
				id: 'log-2',
				runId: 'run-2',
				cascadeLog: null,
				engineLog: 'engine only',
			};
			mockDb.chain.where.mockResolvedValueOnce([mockLogs]);

			const result = await getRunLogs('run-2');

			expect(result).toEqual(mockLogs);
			expect(result?.cascadeLog).toBeNull();
		});
	});
});

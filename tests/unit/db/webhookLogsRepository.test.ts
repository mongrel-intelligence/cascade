import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the database client
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockExecute = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockOffset = vi.fn();
const mockGroupBy = vi.fn();

vi.mock('../../../src/db/client.js', () => ({
	getDb: () => ({
		insert: mockInsert,
		select: mockSelect,
		delete: mockDelete,
		execute: mockExecute,
	}),
}));

vi.mock('../../../src/db/schema/index.js', () => ({
	webhookLogs: {
		id: 'id',
		source: 'source',
		method: 'method',
		path: 'path',
		headers: 'headers',
		body: 'body',
		bodyRaw: 'body_raw',
		statusCode: 'status_code',
		receivedAt: 'received_at',
		projectId: 'project_id',
		eventType: 'event_type',
		processed: 'processed',
	},
}));

import {
	getWebhookLogById,
	getWebhookLogStats,
	insertWebhookLog,
	listWebhookLogs,
	pruneWebhookLogs,
} from '../../../src/db/repositories/webhookLogsRepository.js';

describe('webhookLogsRepository', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Default chained mock returns
		mockInsert.mockReturnValue({ values: mockValues });
		mockValues.mockReturnValue({ returning: mockReturning });
		mockSelect.mockReturnValue({ from: mockFrom });
		mockFrom.mockReturnValue({
			where: mockWhere,
			orderBy: mockOrderBy,
			groupBy: mockGroupBy,
		});
		mockWhere.mockReturnValue({ orderBy: mockOrderBy, groupBy: mockGroupBy });
		mockOrderBy.mockReturnValue({ limit: mockLimit });
		mockLimit.mockReturnValue({ offset: mockOffset });
		mockGroupBy.mockResolvedValue([]);
		mockOffset.mockResolvedValue([]);
		mockDelete.mockReturnValue({ where: mockWhere });
		mockExecute.mockResolvedValue(undefined);
	});

	describe('insertWebhookLog', () => {
		it('inserts a webhook log and returns the id', async () => {
			mockReturning.mockResolvedValue([{ id: 'log-uuid-1' }]);

			const result = await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/trello/webhook',
				statusCode: 200,
				processed: true,
			});

			expect(result).toBe('log-uuid-1');
			expect(mockInsert).toHaveBeenCalled();
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					source: 'trello',
					method: 'POST',
					path: '/trello/webhook',
					statusCode: 200,
					processed: true,
				}),
			);
		});

		it('inserts with optional fields null when not provided', async () => {
			mockReturning.mockResolvedValue([{ id: 'log-uuid-2' }]);

			await insertWebhookLog({
				source: 'github',
				method: 'POST',
				path: '/github/webhook',
			});

			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: null,
					body: null,
					bodyRaw: null,
					statusCode: null,
					projectId: null,
					eventType: null,
					processed: false,
				}),
			);
		});
	});

	describe('listWebhookLogs', () => {
		function setupListMocks(data: unknown[], total: number) {
			const mockCountWhere = vi.fn().mockResolvedValue([{ total }]);
			const mockCountFrom = vi.fn().mockReturnValue({ where: mockCountWhere });

			let callCount = 0;
			mockSelect.mockImplementation(() => {
				callCount++;
				if (callCount === 2) {
					return { from: mockCountFrom };
				}
				return { from: mockFrom };
			});
			mockOffset.mockResolvedValue(data);
		}

		it('returns data and total', async () => {
			const mockData = [{ id: 'log-1', source: 'trello' }];
			setupListMocks(mockData, 1);

			const result = await listWebhookLogs({ limit: 10, offset: 0 });

			expect(result.data).toEqual(mockData);
			expect(result.total).toBe(1);
		});

		it('applies source filter', async () => {
			setupListMocks([], 0);

			await listWebhookLogs({ source: 'trello', limit: 10, offset: 0 });

			// Verifies that select was called (filter applied via drizzle-orm's eq)
			expect(mockSelect).toHaveBeenCalled();
		});

		it('returns empty result when no logs', async () => {
			setupListMocks([], 0);

			const result = await listWebhookLogs({ limit: 10, offset: 0 });

			expect(result.data).toEqual([]);
			expect(result.total).toBe(0);
		});
	});

	describe('getWebhookLogById', () => {
		it('returns null when not found', async () => {
			mockWhere.mockResolvedValue([]);

			const result = await getWebhookLogById('nonexistent-id');

			expect(result).toBeNull();
		});

		it('returns the log when found', async () => {
			const mockLog = { id: 'log-1', source: 'trello', method: 'POST' };
			mockWhere.mockResolvedValue([mockLog]);

			const result = await getWebhookLogById('log-1');

			expect(result).toEqual(mockLog);
		});
	});

	describe('pruneWebhookLogs', () => {
		it('executes delete query with retention count', async () => {
			await pruneWebhookLogs(1000);

			expect(mockExecute).toHaveBeenCalled();
		});
	});

	describe('getWebhookLogStats', () => {
		it('returns counts per source', async () => {
			const mockStats = [
				{ source: 'trello', count: 10 },
				{ source: 'github', count: 5 },
			];
			mockGroupBy.mockResolvedValue(mockStats);

			const result = await getWebhookLogStats();

			expect(result).toEqual(mockStats);
		});
	});
});

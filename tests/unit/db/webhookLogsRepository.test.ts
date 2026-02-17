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

		// Set up chained mock returns
		mockInsert.mockReturnValue({ values: mockValues });
		mockValues.mockReturnValue({ returning: mockReturning });
		mockSelect.mockReturnValue({ from: mockFrom });
		mockFrom.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy, groupBy: mockGroupBy });
		mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
		mockOrderBy.mockReturnValue({ limit: mockLimit, where: mockWhere });
		mockLimit.mockReturnValue({ offset: mockOffset });
		mockOffset.mockResolvedValue([]);
		mockGroupBy.mockReturnValue({ orderBy: mockOrderBy });
		mockExecute.mockResolvedValue([]);
	});

	describe('insertWebhookLog', () => {
		it('inserts a webhook log and returns the id', async () => {
			mockReturning.mockResolvedValue([{ id: 'log-uuid-1' }]);

			const result = await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/trello/webhook',
				headers: { 'content-type': 'application/json' },
				body: { action: { type: 'updateCard' } },
				statusCode: 200,
				eventType: 'updateCard',
				processed: true,
			});

			expect(mockInsert).toHaveBeenCalled();
			expect(mockValues).toHaveBeenCalled();
			expect(mockReturning).toHaveBeenCalled();
			expect(result).toBe('log-uuid-1');
		});

		it('handles optional fields', async () => {
			mockReturning.mockResolvedValue([{ id: 'log-uuid-2' }]);

			const result = await insertWebhookLog({
				source: 'github',
				method: 'POST',
				path: '/github/webhook',
			});

			expect(result).toBe('log-uuid-2');
		});
	});

	describe('listWebhookLogs', () => {
		it('returns paginated results with total', async () => {
			// listWebhookLogs runs two parallel queries: data + count
			// Data query: select().from().where().orderBy().limit().offset()
			// Count query: select().from().where()
			mockOrderBy.mockReturnValue({ limit: mockLimit, where: mockWhere });
			mockWhere
				.mockReturnValueOnce({ orderBy: mockOrderBy, limit: mockLimit }) // data query .where()
				.mockResolvedValueOnce([{ total: '1' }]); // count query .where()
			mockOffset.mockResolvedValue([]);

			const result = await listWebhookLogs({ limit: 50, offset: 0 });

			expect(mockSelect).toHaveBeenCalled();
			expect(result).toHaveProperty('data');
			expect(result).toHaveProperty('total');
		});
	});

	describe('getWebhookLogById', () => {
		it('returns the log when found', async () => {
			const mockLog = {
				id: 'log-1',
				source: 'github',
				method: 'POST',
				path: '/github/webhook',
				headers: {},
				body: {},
				bodyRaw: null,
				statusCode: 200,
				receivedAt: new Date(),
				projectId: null,
				eventType: 'push',
				processed: true,
			};
			mockLimit.mockReturnValue({ limit: mockLimit });
			mockWhere.mockReturnValue({ limit: mockLimit });
			mockLimit.mockResolvedValue([mockLog]);

			const result = await getWebhookLogById('log-1');

			expect(mockSelect).toHaveBeenCalled();
			expect(result).toEqual(mockLog);
		});

		it('returns null when not found', async () => {
			mockWhere.mockReturnValue({ limit: mockLimit });
			mockLimit.mockResolvedValue([]);

			const result = await getWebhookLogById('nonexistent');

			expect(result).toBeNull();
		});
	});

	describe('pruneWebhookLogs', () => {
		it('calls db.execute with SQL to prune old records', async () => {
			await pruneWebhookLogs(1000);

			expect(mockExecute).toHaveBeenCalled();
		});
	});

	describe('getWebhookLogStats', () => {
		it('returns counts grouped by source', async () => {
			mockGroupBy.mockReturnValue({ orderBy: mockOrderBy });
			mockOrderBy.mockResolvedValue([
				{ source: 'github', count: '10' },
				{ source: 'trello', count: '5' },
			]);

			const result = await getWebhookLogStats();

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({ source: 'github', count: 10 });
			expect(result[1]).toEqual({ source: 'trello', count: 5 });
		});
	});
});

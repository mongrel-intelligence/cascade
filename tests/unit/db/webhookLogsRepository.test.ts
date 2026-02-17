import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the database client
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();
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
		mockFrom.mockReturnValue({
			where: mockWhere,
			orderBy: mockOrderBy,
			groupBy: mockGroupBy,
		});
		mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
		mockOrderBy.mockReturnValue({ limit: mockLimit });
		mockLimit.mockReturnValue({ offset: mockOffset });
		mockOffset.mockResolvedValue([]);
		mockGroupBy.mockResolvedValue([]);
		mockDelete.mockReturnValue({ where: mockWhere });
	});

	describe('insertWebhookLog', () => {
		it('inserts a webhook log and returns the id', async () => {
			mockReturning.mockResolvedValue([{ id: 'log-uuid-1' }]);

			const result = await insertWebhookLog({
				source: 'trello',
				method: 'POST',
				path: '/trello/webhook',
				headers: { 'content-type': 'application/json' },
				body: { action: { type: 'createCard' } },
				statusCode: 200,
				eventType: 'createCard',
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
					eventType: 'createCard',
					processed: true,
				}),
			);
		});

		it('inserts with minimal fields', async () => {
			mockReturning.mockResolvedValue([{ id: 'log-uuid-2' }]);

			const result = await insertWebhookLog({
				source: 'github',
				method: 'POST',
				path: '/github/webhook',
				statusCode: 200,
				processed: false,
			});

			expect(result).toBe('log-uuid-2');
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					source: 'github',
					processed: false,
				}),
			);
		});
	});

	describe('listWebhookLogs', () => {
		it('returns paginated list without filters', async () => {
			const mockData = [{ id: 'log-1', source: 'trello' }];
			const mockTotal = [{ total: 1 }];

			// Mock Promise.all - both queries need to resolve
			mockOffset.mockResolvedValueOnce(mockData);
			mockFrom.mockReturnValueOnce({
				where: mockWhere,
				orderBy: mockOrderBy,
				groupBy: mockGroupBy,
			});
			mockFrom.mockReturnValueOnce({
				where: (w: unknown) => {
					void w;
					return Promise.resolve(mockTotal);
				},
				orderBy: mockOrderBy,
				groupBy: mockGroupBy,
			});

			const result = await listWebhookLogs({ limit: 50, offset: 0 });

			expect(mockSelect).toHaveBeenCalled();
			// Result shape should include data + total
			expect(result).toBeDefined();
		});
	});

	describe('getWebhookLogById', () => {
		it('returns null when not found', async () => {
			mockWhere.mockResolvedValue([]);

			const result = await getWebhookLogById('non-existent-id');

			expect(result).toBeNull();
		});

		it('returns the log when found', async () => {
			const mockLog = { id: 'log-1', source: 'trello' };
			mockWhere.mockResolvedValue([mockLog]);

			const result = await getWebhookLogById('log-1');

			expect(result).toEqual(mockLog);
		});
	});

	describe('pruneWebhookLogs', () => {
		it('calls delete with subquery for retention', async () => {
			mockWhere.mockResolvedValue(undefined);

			await pruneWebhookLogs(1000);

			expect(mockDelete).toHaveBeenCalled();
		});
	});

	describe('getWebhookLogStats', () => {
		it('returns source counts', async () => {
			const statsData = [
				{ source: 'trello', count: 5 },
				{ source: 'github', count: 10 },
			];
			mockGroupBy.mockResolvedValue(statsData);

			const result = await getWebhookLogStats();

			expect(result).toEqual(statsData);
		});
	});
});

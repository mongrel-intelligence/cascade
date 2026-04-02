import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

vi.mock('../../../../src/db/schema/index.js', () => ({
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
		decisionReason: 'decision_reason',
	},
}));

import {
	getWebhookLogById,
	getWebhookLogStats,
	insertWebhookLog,
	listWebhookLogs,
	pruneWebhookLogs,
} from '../../../../src/db/repositories/webhookLogsRepository.js';
import { mockGetDb } from '../../../helpers/sharedMocks.js';

// Helper to build a chainable mock db
function buildMockDb() {
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

	mockInsert.mockReturnValue({ values: mockValues });
	mockValues.mockReturnValue({ returning: mockReturning });
	mockReturning.mockResolvedValue([]);
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

	const db = { insert: mockInsert, select: mockSelect, delete: mockDelete };
	mockGetDb.mockReturnValue(db as never);

	return {
		db,
		chain: {
			insert: mockInsert,
			select: mockSelect,
			delete: mockDelete,
			values: mockValues,
			returning: mockReturning,
			where: mockWhere,
			from: mockFrom,
			orderBy: mockOrderBy,
			limit: mockLimit,
			offset: mockOffset,
			groupBy: mockGroupBy,
		},
	};
}

describe('webhookLogsRepository', () => {
	let mocks: ReturnType<typeof buildMockDb>;

	beforeEach(() => {
		vi.resetAllMocks();
		mocks = buildMockDb();
	});

	describe('insertWebhookLog', () => {
		it('inserts a webhook log and returns the id', async () => {
			mocks.chain.returning.mockResolvedValueOnce([{ id: 'log-uuid-1' }]);

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
			expect(mocks.db.insert).toHaveBeenCalled();
			expect(mocks.chain.values).toHaveBeenCalledWith(
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

		it('defaults processed to false when not provided', async () => {
			mocks.chain.returning.mockResolvedValueOnce([{ id: 'log-uuid-2' }]);

			await insertWebhookLog({
				source: 'github',
				method: 'POST',
				path: '/github/webhook',
				statusCode: 200,
			});

			expect(mocks.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({ processed: false }),
			);
		});

		it('stores optional projectId and decisionReason', async () => {
			mocks.chain.returning.mockResolvedValueOnce([{ id: 'log-uuid-3' }]);

			await insertWebhookLog({
				source: 'github',
				method: 'POST',
				path: '/webhook',
				statusCode: 200,
				projectId: 'proj-1',
				decisionReason: 'duplicate event',
			});

			expect(mocks.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-1',
					decisionReason: 'duplicate event',
				}),
			);
		});
	});

	describe('listWebhookLogs', () => {
		it('returns paginated data and total without filters', async () => {
			const mockData = [{ id: 'log-1', source: 'trello' }];
			const mockTotal = [{ total: 1 }];

			// Two parallel queries: data + count
			mocks.chain.offset.mockResolvedValueOnce(mockData);
			// Second select returns for count query
			const countWhere = vi.fn().mockResolvedValue(mockTotal);
			mocks.chain.from
				.mockReturnValueOnce({
					where: mocks.chain.where,
					orderBy: mocks.chain.orderBy,
					groupBy: mocks.chain.groupBy,
				})
				.mockReturnValueOnce({ where: countWhere });

			const result = await listWebhookLogs({ limit: 50, offset: 0 });

			expect(mocks.db.select).toHaveBeenCalled();
			expect(result).toBeDefined();
		});

		it('applies source filter', async () => {
			mocks.chain.offset.mockResolvedValueOnce([]);
			const countWhere = vi.fn().mockResolvedValue([{ total: 0 }]);
			mocks.chain.from
				.mockReturnValueOnce({
					where: mocks.chain.where,
					orderBy: mocks.chain.orderBy,
				})
				.mockReturnValueOnce({ where: countWhere });

			await listWebhookLogs({ source: 'trello', limit: 50, offset: 0 });

			expect(mocks.db.select).toHaveBeenCalled();
		});

		it('applies eventType filter', async () => {
			mocks.chain.offset.mockResolvedValueOnce([]);
			const countWhere = vi.fn().mockResolvedValue([{ total: 0 }]);
			mocks.chain.from
				.mockReturnValueOnce({
					where: mocks.chain.where,
					orderBy: mocks.chain.orderBy,
				})
				.mockReturnValueOnce({ where: countWhere });

			await listWebhookLogs({ eventType: 'push', limit: 50, offset: 0 });

			expect(mocks.db.select).toHaveBeenCalled();
		});

		it('applies date range filters', async () => {
			mocks.chain.offset.mockResolvedValueOnce([]);
			const countWhere = vi.fn().mockResolvedValue([{ total: 0 }]);
			mocks.chain.from
				.mockReturnValueOnce({
					where: mocks.chain.where,
					orderBy: mocks.chain.orderBy,
				})
				.mockReturnValueOnce({ where: countWhere });

			await listWebhookLogs({
				receivedAfter: new Date('2024-01-01'),
				receivedBefore: new Date('2024-12-31'),
				limit: 10,
				offset: 0,
			});

			expect(mocks.db.select).toHaveBeenCalled();
		});
	});

	describe('getWebhookLogById', () => {
		it('returns log when found by full UUID', async () => {
			const mockLog = { id: '11111111-1111-1111-1111-111111111111', source: 'trello' };
			mocks.chain.where.mockResolvedValueOnce([mockLog]);

			const result = await getWebhookLogById('11111111-1111-1111-1111-111111111111');

			expect(result).toEqual(mockLog);
		});

		it('returns null when not found by full UUID', async () => {
			mocks.chain.where.mockResolvedValueOnce([]);

			const result = await getWebhookLogById('00000000-0000-0000-0000-000000000000');

			expect(result).toBeNull();
		});

		it('resolves short ID prefix returning single match', async () => {
			const mockLog = { id: '11111111-1111-1111-1111-111111111111', source: 'trello' };
			mocks.chain.limit.mockResolvedValueOnce([mockLog]);

			const result = await getWebhookLogById('11111111');

			expect(result).toEqual(mockLog);
		});

		it('returns null for ambiguous short ID prefix (multiple matches)', async () => {
			mocks.chain.limit.mockResolvedValueOnce([
				{ id: '11111111-aaaa-0000-0000-000000000000' },
				{ id: '11111111-bbbb-0000-0000-000000000000' },
			]);

			const result = await getWebhookLogById('11111111');

			expect(result).toBeNull();
		});

		it('returns null for short prefix with no matches', async () => {
			mocks.chain.limit.mockResolvedValueOnce([]);

			const result = await getWebhookLogById('aaaabbbb');

			expect(result).toBeNull();
		});

		it('uses short prefix path when id length < 36', async () => {
			mocks.chain.limit.mockResolvedValueOnce([{ id: 'abc-123' }]);

			// Short IDs (length < 36) use SQL LIKE query + limit
			await getWebhookLogById('abc12345');

			// limit should have been called (short prefix path uses limit)
			expect(mocks.chain.limit).toHaveBeenCalled();
		});
	});

	describe('pruneWebhookLogs', () => {
		it('calls delete to prune logs beyond retention count', async () => {
			mocks.chain.where.mockResolvedValueOnce(undefined);

			await pruneWebhookLogs(1000);

			expect(mocks.db.delete).toHaveBeenCalled();
		});

		it('can prune to different retention counts', async () => {
			mocks.chain.where.mockResolvedValueOnce(undefined);

			await pruneWebhookLogs(500);

			expect(mocks.db.delete).toHaveBeenCalled();
		});
	});

	describe('getWebhookLogStats', () => {
		it('returns stats grouped by source', async () => {
			const statsData = [
				{ source: 'trello', count: 5 },
				{ source: 'github', count: 10 },
				{ source: 'jira', count: 3 },
			];
			mocks.chain.groupBy.mockResolvedValueOnce(statsData);

			const result = await getWebhookLogStats();

			expect(result).toEqual(statsData);
		});

		it('returns empty array when no logs exist', async () => {
			mocks.chain.groupBy.mockResolvedValueOnce([]);

			const result = await getWebhookLogStats();

			expect(result).toEqual([]);
		});
	});
});

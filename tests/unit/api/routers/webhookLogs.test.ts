import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';

// Mock repository functions
const mockListWebhookLogs = vi.fn();
const mockGetWebhookLogById = vi.fn();
const mockGetWebhookLogStats = vi.fn();

vi.mock('../../../../src/db/repositories/webhookLogsRepository.js', () => ({
	listWebhookLogs: (...args: unknown[]) => mockListWebhookLogs(...args),
	getWebhookLogById: (...args: unknown[]) => mockGetWebhookLogById(...args),
	getWebhookLogStats: (...args: unknown[]) => mockGetWebhookLogStats(...args),
}));

import { webhookLogsRouter } from '../../../../src/api/routers/webhookLogs.js';

function createCaller(ctx: TRPCContext) {
	return webhookLogsRouter.createCaller(ctx);
}

const mockUser = {
	id: 'user-1',
	orgId: 'org-1',
	email: 'test@example.com',
	name: 'Test',
	role: 'admin',
};

const LOG_UUID = 'aaaaaaaa-1111-2222-3333-444444444444';

describe('webhookLogsRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('list', () => {
		it('returns paginated webhook logs', async () => {
			const mockResult = {
				data: [
					{
						id: LOG_UUID,
						source: 'trello',
						method: 'POST',
						path: '/trello/webhook',
						statusCode: 200,
						receivedAt: new Date(),
						projectId: null,
						eventType: 'updateCard',
						processed: true,
					},
				],
				total: 1,
			};
			mockListWebhookLogs.mockResolvedValue(mockResult);

			const caller = createCaller({ user: mockUser });
			const result = await caller.list({ limit: 50, offset: 0 });

			expect(mockListWebhookLogs).toHaveBeenCalledWith({
				source: undefined,
				eventType: undefined,
				receivedAfter: undefined,
				receivedBefore: undefined,
				limit: 50,
				offset: 0,
			});
			expect(result).toEqual(mockResult);
		});

		it('passes filters to repository', async () => {
			mockListWebhookLogs.mockResolvedValue({ data: [], total: 0 });

			const caller = createCaller({ user: mockUser });
			await caller.list({ source: 'github', eventType: 'push', limit: 10, offset: 0 });

			expect(mockListWebhookLogs).toHaveBeenCalledWith(
				expect.objectContaining({ source: 'github', eventType: 'push' }),
			);
		});

		it('requires authentication', async () => {
			const caller = createCaller({ user: null });
			await expect(caller.list({})).rejects.toThrow();
		});
	});

	describe('getById', () => {
		it('returns a webhook log by id', async () => {
			const mockLog = {
				id: LOG_UUID,
				source: 'github',
				method: 'POST',
				path: '/github/webhook',
				headers: {},
				body: {},
				bodyRaw: null,
				statusCode: 200,
				receivedAt: new Date(),
				projectId: null,
				eventType: 'pull_request',
				processed: true,
			};
			mockGetWebhookLogById.mockResolvedValue(mockLog);

			const caller = createCaller({ user: mockUser });
			const result = await caller.getById({ id: LOG_UUID });

			expect(mockGetWebhookLogById).toHaveBeenCalledWith(LOG_UUID);
			expect(result).toEqual(mockLog);
		});

		it('throws NOT_FOUND when log does not exist', async () => {
			mockGetWebhookLogById.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser });
			await expect(caller.getById({ id: LOG_UUID })).rejects.toThrow(TRPCError);
		});

		it('requires authentication', async () => {
			const caller = createCaller({ user: null });
			await expect(caller.getById({ id: LOG_UUID })).rejects.toThrow();
		});
	});

	describe('getStats', () => {
		it('returns stats grouped by source', async () => {
			const mockStats = [
				{ source: 'github', count: 10 },
				{ source: 'trello', count: 5 },
			];
			mockGetWebhookLogStats.mockResolvedValue(mockStats);

			const caller = createCaller({ user: mockUser });
			const result = await caller.getStats();

			expect(mockGetWebhookLogStats).toHaveBeenCalled();
			expect(result).toEqual(mockStats);
		});

		it('requires authentication', async () => {
			const caller = createCaller({ user: null });
			await expect(caller.getStats()).rejects.toThrow();
		});
	});
});

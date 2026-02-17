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

const authedCtx: TRPCContext = {
	user: mockUser,
	effectiveOrgId: 'org-1',
};

const unauthCtx: TRPCContext = {
	user: null,
	effectiveOrgId: null,
};

describe('webhookLogsRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('list', () => {
		it('requires authentication', async () => {
			const caller = createCaller(unauthCtx);
			await expect(caller.list({})).rejects.toThrow('UNAUTHORIZED');
		});

		it('returns paginated webhook logs', async () => {
			const mockData = {
				data: [
					{
						id: 'log-1',
						source: 'trello',
						method: 'POST',
						path: '/trello/webhook',
						eventType: 'updateCard',
						statusCode: 200,
						processed: true,
						receivedAt: new Date(),
					},
				],
				total: 1,
			};
			mockListWebhookLogs.mockResolvedValue(mockData);

			const caller = createCaller(authedCtx);
			const result = await caller.list({});

			expect(result).toEqual(mockData);
			expect(mockListWebhookLogs).toHaveBeenCalledWith({
				source: undefined,
				eventType: undefined,
				receivedAfter: undefined,
				receivedBefore: undefined,
				limit: 50,
				offset: 0,
			});
		});

		it('passes source and eventType filters', async () => {
			mockListWebhookLogs.mockResolvedValue({ data: [], total: 0 });

			const caller = createCaller(authedCtx);
			await caller.list({ source: 'github', eventType: 'push' });

			expect(mockListWebhookLogs).toHaveBeenCalledWith(
				expect.objectContaining({
					source: 'github',
					eventType: 'push',
				}),
			);
		});

		it('passes date range filters', async () => {
			mockListWebhookLogs.mockResolvedValue({ data: [], total: 0 });

			const caller = createCaller(authedCtx);
			const after = '2024-01-01T00:00:00.000Z';
			const before = '2024-12-31T23:59:59.000Z';
			await caller.list({ receivedAfter: after, receivedBefore: before });

			expect(mockListWebhookLogs).toHaveBeenCalledWith(
				expect.objectContaining({
					receivedAfter: new Date(after),
					receivedBefore: new Date(before),
				}),
			);
		});

		it('validates limit range', async () => {
			const caller = createCaller(authedCtx);
			await expect(caller.list({ limit: 200 })).rejects.toThrow();
		});
	});

	describe('getById', () => {
		it('requires authentication', async () => {
			const caller = createCaller(unauthCtx);
			await expect(caller.getById({ id: '00000000-0000-0000-0000-000000000001' })).rejects.toThrow(
				'UNAUTHORIZED',
			);
		});

		it('throws NOT_FOUND when log does not exist', async () => {
			mockGetWebhookLogById.mockResolvedValue(null);

			const caller = createCaller(authedCtx);
			await expect(
				caller.getById({ id: '00000000-0000-0000-0000-000000000001' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});

		it('returns the log when found', async () => {
			const mockLog = {
				id: '00000000-0000-0000-0000-000000000001',
				source: 'trello',
				method: 'POST',
				path: '/trello/webhook',
				headers: { 'content-type': 'application/json' },
				body: { action: { type: 'updateCard' } },
				bodyRaw: '{"action":{"type":"updateCard"}}',
				statusCode: 200,
				processed: true,
				receivedAt: new Date(),
				projectId: 'proj-1',
				eventType: 'updateCard',
			};
			mockGetWebhookLogById.mockResolvedValue(mockLog);

			const caller = createCaller(authedCtx);
			const result = await caller.getById({ id: mockLog.id });

			expect(result).toEqual(mockLog);
		});

		it('rejects invalid UUIDs', async () => {
			const caller = createCaller(authedCtx);
			await expect(caller.getById({ id: 'not-a-uuid' })).rejects.toThrow();
		});
	});

	describe('getStats', () => {
		it('requires authentication', async () => {
			const caller = createCaller(unauthCtx);
			await expect(caller.getStats()).rejects.toThrow('UNAUTHORIZED');
		});

		it('returns stats from repository', async () => {
			const mockStats = [
				{ source: 'trello', count: 42 },
				{ source: 'github', count: 17 },
			];
			mockGetWebhookLogStats.mockResolvedValue(mockStats);

			const caller = createCaller(authedCtx);
			const result = await caller.getStats();

			expect(result).toEqual(mockStats);
		});
	});
});

import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockUser } from '../../../helpers/factories.js';

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

const mockUser = createMockUser();

const LOG_UUID = 'aaaaaaaa-1111-2222-3333-444444444444';

describe('webhookLogsRouter', () => {
	describe('list', () => {
		it('returns paginated webhook logs', async () => {
			const mockData = {
				data: [{ id: LOG_UUID, source: 'trello', eventType: 'createCard' }],
				total: 1,
			};
			mockListWebhookLogs.mockResolvedValue(mockData);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.list({ limit: 50, offset: 0 });

			expect(result).toEqual(mockData);
			expect(mockListWebhookLogs).toHaveBeenCalledWith(
				expect.objectContaining({ limit: 50, offset: 0 }),
			);
		});

		it('passes source and eventType filters', async () => {
			mockListWebhookLogs.mockResolvedValue({ data: [], total: 0 });

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			await caller.list({ source: 'github', eventType: 'pull_request', limit: 20, offset: 0 });

			expect(mockListWebhookLogs).toHaveBeenCalledWith(
				expect.objectContaining({ source: 'github', eventType: 'pull_request' }),
			);
		});

		it('throws UNAUTHORIZED when no user', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.list({ limit: 50, offset: 0 })).rejects.toThrow(TRPCError);
		});
	});

	describe('getById', () => {
		it('returns the log when found', async () => {
			const mockLog = { id: LOG_UUID, source: 'github', processed: true };
			mockGetWebhookLogById.mockResolvedValue(mockLog);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.getById({ id: LOG_UUID });

			expect(result).toEqual(mockLog);
			expect(mockGetWebhookLogById).toHaveBeenCalledWith(LOG_UUID);
		});

		it('throws NOT_FOUND when log does not exist', async () => {
			mockGetWebhookLogById.mockResolvedValue(null);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			await expect(caller.getById({ id: LOG_UUID })).rejects.toThrow(TRPCError);
		});

		it('throws UNAUTHORIZED when no user', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.getById({ id: LOG_UUID })).rejects.toThrow(TRPCError);
		});
	});

	describe('getStats', () => {
		it('returns source stats', async () => {
			const mockStats = [
				{ source: 'trello', count: 10 },
				{ source: 'github', count: 5 },
			];
			mockGetWebhookLogStats.mockResolvedValue(mockStats);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.getStats();

			expect(result).toEqual(mockStats);
		});

		it('throws UNAUTHORIZED when no user', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.getStats()).rejects.toThrow(TRPCError);
		});
	});
});

import { describe, expect, it, vi } from 'vitest';
import { createMockSuperAdmin, createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

// Mock repository functions
const { mockListWebhookLogs, mockGetWebhookLogById, mockGetWebhookLogStats } = vi.hoisted(() => ({
	mockListWebhookLogs: vi.fn(),
	mockGetWebhookLogById: vi.fn(),
	mockGetWebhookLogStats: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/webhookLogsRepository.js', () => ({
	listWebhookLogs: mockListWebhookLogs,
	getWebhookLogById: mockGetWebhookLogById,
	getWebhookLogStats: mockGetWebhookLogStats,
}));

import { webhookLogsRouter } from '../../../../src/api/routers/webhookLogs.js';

const createCaller = createCallerFor(webhookLogsRouter);

const mockUser = createMockSuperAdmin();

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
			await expectTRPCError(caller.list({ limit: 50, offset: 0 }), 'UNAUTHORIZED');
		});

		it('throws FORBIDDEN for admin role (not superadmin)', async () => {
			const adminUser = createMockUser({ role: 'admin' });
			const caller = createCaller({ user: adminUser, effectiveOrgId: adminUser.orgId });
			await expectTRPCError(caller.list({ limit: 50, offset: 0 }), 'FORBIDDEN');
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
			await expectTRPCError(caller.getById({ id: LOG_UUID }), 'NOT_FOUND');
		});

		it('throws UNAUTHORIZED when no user', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.getById({ id: LOG_UUID }), 'UNAUTHORIZED');
		});

		it('throws FORBIDDEN for admin role (not superadmin)', async () => {
			const adminUser = createMockUser({ role: 'admin' });
			const caller = createCaller({ user: adminUser, effectiveOrgId: adminUser.orgId });
			await expectTRPCError(caller.getById({ id: LOG_UUID }), 'FORBIDDEN');
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
			await expectTRPCError(caller.getStats(), 'UNAUTHORIZED');
		});

		it('throws FORBIDDEN for admin role (not superadmin)', async () => {
			const adminUser = createMockUser({ role: 'admin' });
			const caller = createCaller({ user: adminUser, effectiveOrgId: adminUser.orgId });
			await expectTRPCError(caller.getStats(), 'FORBIDDEN');
		});
	});
});

import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

const { mockList, mockCreate, mockSetEnabled, mockDelete, mockGetProjectId, mockVerifyAccess } =
	vi.hoisted(() => ({
		mockList: vi.fn(),
		mockCreate: vi.fn(),
		mockSetEnabled: vi.fn(),
		mockDelete: vi.fn(),
		mockGetProjectId: vi.fn(),
		mockVerifyAccess: vi.fn(),
	}));

vi.mock('../../../../src/db/repositories/subscriptionsRepository.js', () => ({
	listSubscriptions: mockList,
	createSubscription: mockCreate,
	setSubscriptionEnabled: mockSetEnabled,
	deleteSubscription: mockDelete,
	getSubscriptionProjectId: mockGetProjectId,
}));

vi.mock('../../../../src/api/routers/_shared/projectAccess.js', () => ({
	verifyProjectOrgAccess: mockVerifyAccess,
}));

import { subscriptionsRouter } from '../../../../src/api/routers/subscriptions.js';

const createCaller = createCallerFor(subscriptionsRouter);
const mockUser = createMockUser();
const authed = () => createCaller({ user: mockUser, effectiveOrgId: mockUser.orgId });

describe('subscriptionsRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockVerifyAccess.mockResolvedValue(undefined);
		mockGetProjectId.mockResolvedValue('proj-1');
	});

	describe('list', () => {
		it('maps fields and never returns the token', async () => {
			const reset = new Date('2026-11-13T12:00:00.000Z');
			mockList.mockResolvedValue([
				{
					id: 1,
					projectId: 'proj-1',
					name: 'Sub 1',
					enabled: true,
					fiveHourPct: 40,
					fiveHourResetAt: reset,
					sevenDayPct: 10,
					sevenDayResetAt: null,
					value: 'should-not-leak',
				},
			]);

			const result = await authed().list({ projectId: 'proj-1' });

			expect(mockVerifyAccess).toHaveBeenCalledWith('proj-1', 'org-1');
			expect(result).toEqual([
				{
					id: 1,
					name: 'Sub 1',
					enabled: true,
					fiveHourPct: 40,
					fiveHourResetAt: reset.toISOString(),
					sevenDayPct: 10,
					sevenDayResetAt: null,
				},
			]);
			expect(JSON.stringify(result)).not.toContain('should-not-leak');
		});

		it('throws UNAUTHORIZED without a user', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.list({ projectId: 'proj-1' }), 'UNAUTHORIZED');
		});

		it('throws NOT_FOUND when the project belongs to another org', async () => {
			mockVerifyAccess.mockRejectedValue(new TRPCError({ code: 'NOT_FOUND' }));
			await expectTRPCError(authed().list({ projectId: 'proj-x' }), 'NOT_FOUND');
			expect(mockList).not.toHaveBeenCalled();
		});
	});

	describe('create', () => {
		it('verifies access then creates', async () => {
			mockCreate.mockResolvedValue(5);
			const result = await authed().create({ projectId: 'proj-1', name: 'S', token: 'tok' });
			expect(mockVerifyAccess).toHaveBeenCalledWith('proj-1', 'org-1');
			expect(mockCreate).toHaveBeenCalledWith('proj-1', 'S', 'tok');
			expect(result).toEqual({ id: 5 });
		});

		it('rejects an empty name or token', async () => {
			await expectTRPCError(
				authed().create({ projectId: 'proj-1', name: '', token: 'tok' }),
				'BAD_REQUEST',
			);
			await expectTRPCError(
				authed().create({ projectId: 'proj-1', name: 'S', token: '' }),
				'BAD_REQUEST',
			);
			expect(mockCreate).not.toHaveBeenCalled();
		});
	});

	describe('setEnabled / delete', () => {
		it('authorizes via the subscription project before updating', async () => {
			await authed().setEnabled({ id: 3, enabled: false });
			expect(mockGetProjectId).toHaveBeenCalledWith(3);
			expect(mockVerifyAccess).toHaveBeenCalledWith('proj-1', 'org-1');
			expect(mockSetEnabled).toHaveBeenCalledWith(3, false);
		});

		it('deletes after authorization', async () => {
			await authed().delete({ id: 3 });
			expect(mockDelete).toHaveBeenCalledWith(3);
		});

		it('throws NOT_FOUND for an unknown subscription id', async () => {
			mockGetProjectId.mockResolvedValue(null);
			await expectTRPCError(authed().setEnabled({ id: 99, enabled: true }), 'NOT_FOUND');
			await expectTRPCError(authed().delete({ id: 99 }), 'NOT_FOUND');
			expect(mockSetEnabled).not.toHaveBeenCalled();
			expect(mockDelete).not.toHaveBeenCalled();
		});

		it('throws NOT_FOUND when the subscription belongs to another org', async () => {
			mockVerifyAccess.mockRejectedValue(new TRPCError({ code: 'NOT_FOUND' }));
			await expectTRPCError(authed().delete({ id: 3 }), 'NOT_FOUND');
			expect(mockDelete).not.toHaveBeenCalled();
		});
	});
});

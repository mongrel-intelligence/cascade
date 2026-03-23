import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockUser } from '../../../helpers/factories.js';
import { createCallerFor, expectTRPCError } from '../../../helpers/trpcTestHarness.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockListWorkItems, mockGetRunsByWorkItem, mockVerifyProjectOrgAccess } = vi.hoisted(() => ({
	mockListWorkItems: vi.fn(),
	mockGetRunsByWorkItem: vi.fn(),
	mockVerifyProjectOrgAccess: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	listWorkItems: mockListWorkItems,
}));

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	getRunsByWorkItem: mockGetRunsByWorkItem,
}));

vi.mock('../../../../src/api/routers/_shared/projectAccess.js', () => ({
	verifyProjectOrgAccess: mockVerifyProjectOrgAccess,
}));

import { workItemsRouter } from '../../../../src/api/routers/workItems.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createCaller = createCallerFor(workItemsRouter);

const mockUser = createMockUser();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('workItemsRouter', () => {
	beforeEach(() => {
		mockVerifyProjectOrgAccess.mockResolvedValue(undefined);
	});

	// =========================================================================
	// list
	// =========================================================================
	describe('list', () => {
		it('returns work items for a project', async () => {
			const mockItems = [
				{ workItemId: 'wi-1', workItemUrl: null, workItemTitle: 'Card 1', prCount: 2, runCount: 3 },
				{
					workItemId: 'wi-2',
					workItemUrl: 'https://trello.com/c/abc',
					workItemTitle: 'Card 2',
					prCount: 1,
					runCount: 0,
				},
			];
			mockListWorkItems.mockResolvedValue(mockItems);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.list({ projectId: 'test-project' });

			expect(result).toEqual(mockItems);
			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('test-project', 'org-1');
			expect(mockListWorkItems).toHaveBeenCalledWith('org-1', 'test-project');
		});

		it('returns work items across all projects when no projectId given', async () => {
			const mockItems = [
				{ workItemId: 'wi-1', workItemUrl: null, workItemTitle: 'Card 1', prCount: 2, runCount: 3 },
			];
			mockListWorkItems.mockResolvedValue(mockItems);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.list({});

			expect(result).toEqual(mockItems);
			expect(mockVerifyProjectOrgAccess).not.toHaveBeenCalled();
			expect(mockListWorkItems).toHaveBeenCalledWith('org-1', undefined);
		});

		it('returns empty array when no work items exist', async () => {
			mockListWorkItems.mockResolvedValue([]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.list({ projectId: 'test-project' });

			expect(result).toEqual([]);
		});

		it('throws UNAUTHORIZED when no user', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(caller.list({ projectId: 'test-project' }), 'UNAUTHORIZED');
		});

		it('throws when project does not belong to org', async () => {
			mockVerifyProjectOrgAccess.mockRejectedValue(new TRPCError({ code: 'NOT_FOUND' }));

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			await expect(caller.list({ projectId: 'other-project' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});
	});

	// =========================================================================
	// runs
	// =========================================================================
	describe('runs', () => {
		it('returns agent runs for a specific work item', async () => {
			const mockRuns = [
				{ id: 'run-1', projectId: 'test-project', cardId: 'wi-1', status: 'completed' },
				{ id: 'run-2', projectId: 'test-project', cardId: 'wi-1', status: 'failed' },
			];
			mockGetRunsByWorkItem.mockResolvedValue(mockRuns);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.runs({ projectId: 'test-project', workItemId: 'wi-1' });

			expect(result).toEqual(mockRuns);
			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('test-project', 'org-1');
			expect(mockGetRunsByWorkItem).toHaveBeenCalledWith('test-project', 'wi-1');
		});

		it('returns empty array when no runs exist for work item', async () => {
			mockGetRunsByWorkItem.mockResolvedValue([]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.runs({ projectId: 'test-project', workItemId: 'wi-99' });

			expect(result).toEqual([]);
		});

		it('throws UNAUTHORIZED when no user', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expectTRPCError(
				caller.runs({ projectId: 'test-project', workItemId: 'wi-1' }),
				'UNAUTHORIZED',
			);
		});

		it('throws when project does not belong to org', async () => {
			mockVerifyProjectOrgAccess.mockRejectedValue(new TRPCError({ code: 'NOT_FOUND' }));

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			await expect(
				caller.runs({ projectId: 'other-project', workItemId: 'wi-1' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});
	});
});

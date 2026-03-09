import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCContext } from '../../../../src/api/trpc.js';
import { createMockUser } from '../../../helpers/factories.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockListPRsForProject = vi.fn();
const mockListPRsForOrg = vi.fn();
const mockListPRsForWorkItem = vi.fn();
const mockGetRunsForPR = vi.fn();

vi.mock('../../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	listPRsForProject: (...args: unknown[]) => mockListPRsForProject(...args),
	listPRsForOrg: (...args: unknown[]) => mockListPRsForOrg(...args),
	listPRsForWorkItem: (...args: unknown[]) => mockListPRsForWorkItem(...args),
}));

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	getRunsForPR: (...args: unknown[]) => mockGetRunsForPR(...args),
}));

const mockVerifyProjectOrgAccess = vi.fn();

vi.mock('../../../../src/api/routers/_shared/projectAccess.js', () => ({
	verifyProjectOrgAccess: (...args: unknown[]) => mockVerifyProjectOrgAccess(...args),
}));

import { prsRouter } from '../../../../src/api/routers/prs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCaller(ctx: TRPCContext) {
	return prsRouter.createCaller(ctx);
}

const mockUser = createMockUser();

const mockPRSummary = {
	prNumber: 42,
	repoFullName: 'owner/repo',
	prUrl: 'https://github.com/owner/repo/pull/42',
	prTitle: 'feat: add feature',
	workItemId: 'wi-1',
	workItemUrl: 'https://trello.com/c/abc',
	workItemTitle: 'Card 1',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('prsRouter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockVerifyProjectOrgAccess.mockResolvedValue(undefined);
	});

	// =========================================================================
	// list
	// =========================================================================
	describe('list', () => {
		it('returns PRs for a project', async () => {
			const mockPRs = [mockPRSummary, { ...mockPRSummary, prNumber: 43 }];
			mockListPRsForProject.mockResolvedValue(mockPRs);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.list({ projectId: 'test-project' });

			expect(result).toEqual(mockPRs);
			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('test-project', 'org-1');
			expect(mockListPRsForProject).toHaveBeenCalledWith('test-project');
		});

		it('returns PRs across all projects when no projectId given', async () => {
			const mockPRs = [
				mockPRSummary,
				{ ...mockPRSummary, prNumber: 43, repoFullName: 'owner/other-repo' },
			];
			mockListPRsForOrg.mockResolvedValue(mockPRs);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.list({});

			expect(result).toEqual(mockPRs);
			expect(mockVerifyProjectOrgAccess).not.toHaveBeenCalled();
			expect(mockListPRsForOrg).toHaveBeenCalledWith('org-1');
		});

		it('returns empty array when no PRs exist', async () => {
			mockListPRsForProject.mockResolvedValue([]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.list({ projectId: 'test-project' });

			expect(result).toEqual([]);
		});

		it('throws UNAUTHORIZED when no user', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.list({ projectId: 'test-project' })).rejects.toThrow(TRPCError);
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
	// forWorkItem
	// =========================================================================
	describe('forWorkItem', () => {
		it('returns PRs linked to a specific work item', async () => {
			const mockPRs = [mockPRSummary];
			mockListPRsForWorkItem.mockResolvedValue(mockPRs);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.forWorkItem({ projectId: 'test-project', workItemId: 'wi-1' });

			expect(result).toEqual(mockPRs);
			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('test-project', 'org-1');
			expect(mockListPRsForWorkItem).toHaveBeenCalledWith('test-project', 'wi-1');
		});

		it('returns empty array when no PRs linked to work item', async () => {
			mockListPRsForWorkItem.mockResolvedValue([]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.forWorkItem({ projectId: 'test-project', workItemId: 'wi-99' });

			expect(result).toEqual([]);
		});

		it('throws UNAUTHORIZED when no user', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(
				caller.forWorkItem({ projectId: 'test-project', workItemId: 'wi-1' }),
			).rejects.toThrow(TRPCError);
		});
	});

	// =========================================================================
	// runs
	// =========================================================================
	describe('runs', () => {
		it('returns agent runs for a specific PR', async () => {
			const mockRuns = [
				{ id: 'run-1', projectId: 'test-project', prNumber: 42, status: 'completed' },
				{ id: 'run-2', projectId: 'test-project', prNumber: 42, status: 'failed' },
			];
			mockGetRunsForPR.mockResolvedValue(mockRuns);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.runs({ projectId: 'test-project', prNumber: 42 });

			expect(result).toEqual(mockRuns);
			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('test-project', 'org-1');
			expect(mockGetRunsForPR).toHaveBeenCalledWith('test-project', 42);
		});

		it('returns empty array when no runs exist for PR', async () => {
			mockGetRunsForPR.mockResolvedValue([]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.runs({ projectId: 'test-project', prNumber: 999 });

			expect(result).toEqual([]);
		});

		it('throws UNAUTHORIZED when no user', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.runs({ projectId: 'test-project', prNumber: 42 })).rejects.toThrow(
				TRPCError,
			);
		});

		it('throws when project does not belong to org', async () => {
			mockVerifyProjectOrgAccess.mockRejectedValue(new TRPCError({ code: 'NOT_FOUND' }));

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			await expect(caller.runs({ projectId: 'other-project', prNumber: 42 })).rejects.toMatchObject(
				{ code: 'NOT_FOUND' },
			);
		});
	});
});

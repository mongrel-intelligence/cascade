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
const mockListUnifiedWorkForProject = vi.fn();
const mockGetProjectWorkStats = vi.fn();
const mockGetProjectWorkStatsAggregated = vi.fn();

vi.mock('../../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	listPRsForProject: (...args: unknown[]) => mockListPRsForProject(...args),
	listPRsForOrg: (...args: unknown[]) => mockListPRsForOrg(...args),
	listPRsForWorkItem: (...args: unknown[]) => mockListPRsForWorkItem(...args),
	listUnifiedWorkForProject: (...args: unknown[]) => mockListUnifiedWorkForProject(...args),
}));

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	getRunsForPR: (...args: unknown[]) => mockGetRunsForPR(...args),
	getProjectWorkStats: (...args: unknown[]) => mockGetProjectWorkStats(...args),
	getProjectWorkStatsAggregated: (...args: unknown[]) => mockGetProjectWorkStatsAggregated(...args),
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

const mockUnifiedItem = {
	id: 'uuid-1',
	type: 'linked' as const,
	prNumber: 42,
	repoFullName: 'owner/repo',
	prUrl: 'https://github.com/owner/repo/pull/42',
	prTitle: 'feat: add feature',
	workItemId: 'wi-1',
	workItemUrl: 'https://trello.com/c/abc',
	workItemTitle: 'Card 1',
	runCount: 3,
	updatedAt: new Date('2024-01-01'),
	totalCostUsd: '1.2345',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('prsRouter', () => {
	beforeEach(() => {
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

	// =========================================================================
	// listUnified
	// =========================================================================
	describe('listUnified', () => {
		it('returns unified work items for a project', async () => {
			const mockItems = [
				mockUnifiedItem,
				{
					...mockUnifiedItem,
					id: 'uuid-2',
					type: 'pr' as const,
					prNumber: 43,
					workItemId: null,
					workItemUrl: null,
					workItemTitle: null,
					runCount: 0,
				},
			];
			mockListUnifiedWorkForProject.mockResolvedValue(mockItems);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.listUnified({ projectId: 'test-project' });

			expect(result).toEqual(mockItems);
			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('test-project', 'org-1');
			expect(mockListUnifiedWorkForProject).toHaveBeenCalledWith('test-project');
		});

		it('returns empty array when no work exists for project', async () => {
			mockListUnifiedWorkForProject.mockResolvedValue([]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.listUnified({ projectId: 'test-project' });

			expect(result).toEqual([]);
		});

		it('throws UNAUTHORIZED when no user', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.listUnified({ projectId: 'test-project' })).rejects.toThrow(TRPCError);
		});

		it('throws when project does not belong to org', async () => {
			mockVerifyProjectOrgAccess.mockRejectedValue(new TRPCError({ code: 'NOT_FOUND' }));

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			await expect(caller.listUnified({ projectId: 'other-project' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});
	});

	// =========================================================================
	// workStats
	// =========================================================================
	describe('workStats', () => {
		const mockStats = [
			{
				agentType: 'implementation',
				status: 'completed',
				durationMs: 120000,
				costUsd: '0.250000',
				model: 'claude-opus-4-6',
				startedAt: new Date('2024-01-01T10:00:00Z'),
			},
			{
				agentType: 'review',
				status: 'completed',
				durationMs: 60000,
				costUsd: '0.100000',
				model: 'claude-sonnet-4-5',
				startedAt: new Date('2024-01-01T11:00:00Z'),
			},
			{
				agentType: 'implementation',
				status: 'failed',
				durationMs: 30000,
				costUsd: null,
				model: 'claude-opus-4-6',
				startedAt: new Date('2024-01-01T12:00:00Z'),
			},
		];

		it('returns work stats for a project without filters', async () => {
			mockGetProjectWorkStats.mockResolvedValue(mockStats);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.workStats({ projectId: 'test-project' });

			expect(result).toEqual(mockStats);
			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('test-project', 'org-1');
			expect(mockGetProjectWorkStats).toHaveBeenCalledWith('test-project', {
				dateFrom: undefined,
				agentType: undefined,
				status: undefined,
			});
		});

		it('passes dateFrom filter to repository', async () => {
			mockGetProjectWorkStats.mockResolvedValue(mockStats);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const dateFromStr = '2024-01-01T00:00:00.000Z';
			await caller.workStats({ projectId: 'test-project', dateFrom: dateFromStr });

			expect(mockGetProjectWorkStats).toHaveBeenCalledWith('test-project', {
				dateFrom: new Date(dateFromStr),
				agentType: undefined,
				status: undefined,
			});
		});

		it('passes agentType filter to repository', async () => {
			mockGetProjectWorkStats.mockResolvedValue(mockStats);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			await caller.workStats({ projectId: 'test-project', agentType: 'implementation' });

			expect(mockGetProjectWorkStats).toHaveBeenCalledWith('test-project', {
				dateFrom: undefined,
				agentType: 'implementation',
				status: undefined,
			});
		});

		it('passes status filter to repository', async () => {
			mockGetProjectWorkStats.mockResolvedValue(mockStats);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			await caller.workStats({ projectId: 'test-project', status: 'completed' });

			expect(mockGetProjectWorkStats).toHaveBeenCalledWith('test-project', {
				dateFrom: undefined,
				agentType: undefined,
				status: 'completed',
			});
		});

		it('passes all filters combined to repository', async () => {
			mockGetProjectWorkStats.mockResolvedValue(mockStats);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const dateFromStr = '2024-01-01T00:00:00.000Z';
			await caller.workStats({
				projectId: 'test-project',
				dateFrom: dateFromStr,
				agentType: 'review',
				status: 'failed',
			});

			expect(mockGetProjectWorkStats).toHaveBeenCalledWith('test-project', {
				dateFrom: new Date(dateFromStr),
				agentType: 'review',
				status: 'failed',
			});
		});

		it('returns empty array when no completed runs exist', async () => {
			mockGetProjectWorkStats.mockResolvedValue([]);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.workStats({ projectId: 'test-project' });

			expect(result).toEqual([]);
			expect(mockGetProjectWorkStats).toHaveBeenCalledWith('test-project', {
				dateFrom: undefined,
				agentType: undefined,
				status: undefined,
			});
		});

		it('throws UNAUTHORIZED when no user', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.workStats({ projectId: 'test-project' })).rejects.toThrow(TRPCError);
		});

		it('throws when project does not belong to org', async () => {
			mockVerifyProjectOrgAccess.mockRejectedValue(new TRPCError({ code: 'NOT_FOUND' }));

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			await expect(caller.workStats({ projectId: 'other-project' })).rejects.toMatchObject({
				code: 'NOT_FOUND',
			});
		});
	});

	// =========================================================================
	// workStatsAggregated
	// =========================================================================
	describe('workStatsAggregated', () => {
		const mockAggregatedStats = {
			summary: {
				totalRuns: 10,
				completedRuns: 8,
				failedRuns: 2,
				timedOutRuns: 0,
				totalCostUsd: '1.2500',
				avgDurationMs: 90000,
				successRate: 80,
			},
			byAgentType: [
				{
					agentType: 'implementation',
					runCount: 7,
					totalCostUsd: '1.0000',
					totalDurationMs: 630000,
					avgDurationMs: 90000,
				},
				{
					agentType: 'review',
					runCount: 3,
					totalCostUsd: '0.2500',
					totalDurationMs: 270000,
					avgDurationMs: 90000,
				},
			],
		};

		it('returns aggregated stats for a project without filters', async () => {
			mockGetProjectWorkStatsAggregated.mockResolvedValue(mockAggregatedStats);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.workStatsAggregated({ projectId: 'test-project' });

			expect(result).toEqual(mockAggregatedStats);
			expect(mockVerifyProjectOrgAccess).toHaveBeenCalledWith('test-project', 'org-1');
			expect(mockGetProjectWorkStatsAggregated).toHaveBeenCalledWith('test-project', {
				dateFrom: undefined,
				agentType: undefined,
				status: undefined,
			});
		});

		it('passes dateFrom filter to repository', async () => {
			mockGetProjectWorkStatsAggregated.mockResolvedValue(mockAggregatedStats);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const dateFromStr = '2024-01-01T00:00:00.000Z';
			await caller.workStatsAggregated({ projectId: 'test-project', dateFrom: dateFromStr });

			expect(mockGetProjectWorkStatsAggregated).toHaveBeenCalledWith('test-project', {
				dateFrom: new Date(dateFromStr),
				agentType: undefined,
				status: undefined,
			});
		});

		it('passes agentType filter to repository', async () => {
			mockGetProjectWorkStatsAggregated.mockResolvedValue(mockAggregatedStats);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			await caller.workStatsAggregated({ projectId: 'test-project', agentType: 'implementation' });

			expect(mockGetProjectWorkStatsAggregated).toHaveBeenCalledWith('test-project', {
				dateFrom: undefined,
				agentType: 'implementation',
				status: undefined,
			});
		});

		it('passes status filter to repository', async () => {
			mockGetProjectWorkStatsAggregated.mockResolvedValue(mockAggregatedStats);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			await caller.workStatsAggregated({ projectId: 'test-project', status: 'completed' });

			expect(mockGetProjectWorkStatsAggregated).toHaveBeenCalledWith('test-project', {
				dateFrom: undefined,
				agentType: undefined,
				status: 'completed',
			});
		});

		it('passes all filters combined to repository', async () => {
			mockGetProjectWorkStatsAggregated.mockResolvedValue(mockAggregatedStats);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const dateFromStr = '2024-01-01T00:00:00.000Z';
			await caller.workStatsAggregated({
				projectId: 'test-project',
				dateFrom: dateFromStr,
				agentType: 'review',
				status: 'failed',
			});

			expect(mockGetProjectWorkStatsAggregated).toHaveBeenCalledWith('test-project', {
				dateFrom: new Date(dateFromStr),
				agentType: 'review',
				status: 'failed',
			});
		});

		it('returns empty summary when no completed runs exist', async () => {
			const emptyStats = {
				summary: {
					totalRuns: 0,
					completedRuns: 0,
					failedRuns: 0,
					timedOutRuns: 0,
					totalCostUsd: '0.0000',
					avgDurationMs: null,
					successRate: 0,
				},
				byAgentType: [],
			};
			mockGetProjectWorkStatsAggregated.mockResolvedValue(emptyStats);

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			const result = await caller.workStatsAggregated({ projectId: 'test-project' });

			expect(result).toEqual(emptyStats);
			expect(result.summary.totalRuns).toBe(0);
			expect(result.byAgentType).toHaveLength(0);
		});

		it('throws UNAUTHORIZED when no user', async () => {
			const caller = createCaller({ user: null, effectiveOrgId: null });
			await expect(caller.workStatsAggregated({ projectId: 'test-project' })).rejects.toThrow(
				TRPCError,
			);
		});

		it('throws when project does not belong to org', async () => {
			mockVerifyProjectOrgAccess.mockRejectedValue(new TRPCError({ code: 'NOT_FOUND' }));

			const caller = createCaller({ user: mockUser, effectiveOrgId: 'org-1' });
			await expect(
				caller.workStatsAggregated({ projectId: 'other-project' }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});
	});
});

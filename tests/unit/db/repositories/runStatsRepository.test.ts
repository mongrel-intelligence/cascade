import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDbClientModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/db/client.js', () => mockDbClientModule);

vi.mock('../../../../src/db/schema/index.js', () => ({
	agentRuns: {
		id: 'id',
		projectId: 'project_id',
		workItemId: 'work_item_id',
		agentType: 'agent_type',
		status: 'status',
		startedAt: 'started_at',
		prNumber: 'pr_number',
		durationMs: 'duration_ms',
		costUsd: 'cost_usd',
		engine: 'engine',
		triggerType: 'trigger_type',
		model: 'model',
		maxIterations: 'max_iterations',
		completedAt: 'completed_at',
		llmIterations: 'llm_iterations',
		gadgetCalls: 'gadget_calls',
		success: 'success',
		error: 'error',
		prUrl: 'pr_url',
		outputSummary: 'output_summary',
		jobId: 'job_id',
	},
	prWorkItems: {
		projectId: 'project_id',
		prNumber: 'pr_number',
		workItemId: 'work_item_id',
		workItemUrl: 'work_item_url',
		workItemTitle: 'work_item_title',
		prTitle: 'pr_title',
	},
	projects: {
		id: 'id',
		orgId: 'org_id',
		name: 'name',
	},
	organizations: {
		id: 'id',
		name: 'name',
	},
}));

vi.mock('../../../../src/db/repositories/joinHelpers.js', () => ({
	buildAgentRunWorkItemJoin: () => 'mock-join-condition',
}));

import { mockGetDb } from '../../../helpers/sharedMocks.js';

import {
	type AggregatedProjectStats,
	getProjectWorkStats,
	getProjectWorkStatsAggregated,
	getRunsByWorkItem,
	getRunsForPR,
	listProjectsForOrg,
	listRuns,
} from '../../../../src/db/repositories/runStatsRepository.js';

// ============================================================================
// Test helper
// ============================================================================

function buildSelectChain(opts: { withInnerJoin?: boolean; withLeftJoin?: boolean } = {}) {
	const chain: Record<string, ReturnType<typeof vi.fn>> = {};
	const methods = ['from', 'where', 'orderBy', 'limit', 'offset', 'groupBy'];
	for (const m of methods) {
		chain[m] = vi.fn().mockReturnValue(chain);
	}
	if (opts.withInnerJoin) {
		chain.innerJoin = vi.fn().mockReturnValue(chain);
	}
	if (opts.withLeftJoin) {
		chain.leftJoin = vi.fn().mockReturnValue(chain);
	}
	// Make thenable
	// biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for Drizzle query chains
	chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
	return chain;
}

describe('runStatsRepository', () => {
	let mockSelect: ReturnType<typeof vi.fn>;
	let mockDb: { select: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.resetAllMocks();
		mockSelect = vi.fn();
		mockDb = { select: mockSelect };
		mockGetDb.mockReturnValue(mockDb as never);
	});

	describe('listRuns', () => {
		it('returns data and total from parallel queries', async () => {
			const dataChain = buildSelectChain({ withInnerJoin: true, withLeftJoin: true });
			const countChain = buildSelectChain({ withInnerJoin: true });

			const mockData = [{ id: 'run-1', projectId: 'proj-1', orgName: 'Org A' }];
			dataChain.offset.mockResolvedValue(mockData);
			countChain.where.mockResolvedValue([{ total: 1 }]);

			mockSelect.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

			const result = await listRuns({ orgId: 'org-1', limit: 10, offset: 0 });

			expect(result.data).toEqual(mockData);
			expect(result.total).toBe(1);
			expect(mockSelect).toHaveBeenCalledTimes(2);
		});

		it('applies projectId filter', async () => {
			const dataChain = buildSelectChain({ withInnerJoin: true, withLeftJoin: true });
			const countChain = buildSelectChain({ withInnerJoin: true });
			dataChain.offset.mockResolvedValue([]);
			countChain.where.mockResolvedValue([{ total: 0 }]);
			mockSelect.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

			await listRuns({ orgId: 'org-1', projectId: 'proj-1', limit: 10, offset: 0 });

			expect(mockSelect).toHaveBeenCalledTimes(2);
		});

		it('applies status filter', async () => {
			const dataChain = buildSelectChain({ withInnerJoin: true, withLeftJoin: true });
			const countChain = buildSelectChain({ withInnerJoin: true });
			dataChain.offset.mockResolvedValue([]);
			countChain.where.mockResolvedValue([{ total: 0 }]);
			mockSelect.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

			await listRuns({
				orgId: 'org-1',
				status: ['running', 'failed'],
				limit: 10,
				offset: 0,
			});

			expect(mockSelect).toHaveBeenCalledTimes(2);
		});

		it('applies date range filters', async () => {
			const dataChain = buildSelectChain({ withInnerJoin: true, withLeftJoin: true });
			const countChain = buildSelectChain({ withInnerJoin: true });
			dataChain.offset.mockResolvedValue([]);
			countChain.where.mockResolvedValue([{ total: 0 }]);
			mockSelect.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

			await listRuns({
				orgId: 'org-1',
				startedAfter: new Date('2024-01-01'),
				startedBefore: new Date('2024-12-31'),
				limit: 10,
				offset: 0,
			});

			expect(mockSelect).toHaveBeenCalledTimes(2);
		});

		it('uses asc ordering when specified', async () => {
			const dataChain = buildSelectChain({ withInnerJoin: true, withLeftJoin: true });
			const countChain = buildSelectChain({ withInnerJoin: true });
			dataChain.offset.mockResolvedValue([]);
			countChain.where.mockResolvedValue([{ total: 0 }]);
			mockSelect.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

			await listRuns({ limit: 10, offset: 0, sort: 'durationMs', order: 'asc' });

			expect(mockSelect).toHaveBeenCalledTimes(2);
		});

		it('uses costUsd as sort column when specified', async () => {
			const dataChain = buildSelectChain({ withInnerJoin: true, withLeftJoin: true });
			const countChain = buildSelectChain({ withInnerJoin: true });
			dataChain.offset.mockResolvedValue([]);
			countChain.where.mockResolvedValue([{ total: 0 }]);
			mockSelect.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

			await listRuns({ limit: 10, offset: 0, sort: 'costUsd', order: 'desc' });

			expect(mockSelect).toHaveBeenCalledTimes(2);
		});
	});

	describe('listProjectsForOrg', () => {
		it('returns projects for org', async () => {
			const mockProjects = [
				{ id: 'proj-1', name: 'Project Alpha' },
				{ id: 'proj-2', name: 'Project Beta' },
			];
			const chain = buildSelectChain();
			chain.where.mockResolvedValue(mockProjects);
			mockSelect.mockReturnValue(chain);

			const result = await listProjectsForOrg('org-1');

			expect(result).toEqual(mockProjects);
		});

		it('returns empty array when org has no projects', async () => {
			const chain = buildSelectChain();
			chain.where.mockResolvedValue([]);
			mockSelect.mockReturnValue(chain);

			const result = await listProjectsForOrg('org-empty');

			expect(result).toEqual([]);
		});
	});

	describe('getRunsByWorkItem', () => {
		it('returns enriched runs for a work item', async () => {
			const mockRuns = [
				{
					id: 'run-1',
					projectId: 'proj-1',
					workItemId: 'card-1',
					workItemUrl: 'https://trello.com/c/abc',
					workItemTitle: 'Test Card',
					prTitle: null,
				},
			];
			const chain = buildSelectChain({ withLeftJoin: true });
			chain.orderBy.mockResolvedValue(mockRuns);
			mockSelect.mockReturnValue(chain);

			const result = await getRunsByWorkItem('proj-1', 'card-1');

			expect(result).toEqual(mockRuns);
			expect(chain.leftJoin).toHaveBeenCalledWith(expect.anything(), 'mock-join-condition');
		});

		it('returns empty array when no runs exist', async () => {
			const chain = buildSelectChain({ withLeftJoin: true });
			chain.orderBy.mockResolvedValue([]);
			mockSelect.mockReturnValue(chain);

			const result = await getRunsByWorkItem('proj-1', 'nonexistent');

			expect(result).toEqual([]);
		});
	});

	describe('getRunsForPR', () => {
		it('returns enriched runs for a PR number', async () => {
			const mockRuns = [
				{
					id: 'run-3',
					projectId: 'proj-1',
					prNumber: 42,
					workItemUrl: 'https://trello.com/c/xyz',
					workItemTitle: 'Implement feature',
					prTitle: 'feat: implement feature',
				},
			];
			const chain = buildSelectChain({ withLeftJoin: true });
			chain.orderBy.mockResolvedValue(mockRuns);
			mockSelect.mockReturnValue(chain);

			const result = await getRunsForPR('proj-1', 42);

			expect(result).toEqual(mockRuns);
			expect(chain.leftJoin).toHaveBeenCalledWith(expect.anything(), 'mock-join-condition');
		});

		it('returns empty array when no runs exist for PR', async () => {
			const chain = buildSelectChain({ withLeftJoin: true });
			chain.orderBy.mockResolvedValue([]);
			mockSelect.mockReturnValue(chain);

			const result = await getRunsForPR('proj-1', 9999);

			expect(result).toEqual([]);
		});
	});

	describe('getProjectWorkStats', () => {
		it('returns stats with required fields', async () => {
			const mockStats = [
				{
					agentType: 'implementation',
					status: 'completed',
					durationMs: 5000,
					costUsd: '0.1000',
					model: 'claude-3',
					startedAt: new Date('2024-01-01'),
				},
			];
			const chain = buildSelectChain();
			chain.limit.mockResolvedValue(mockStats);
			mockSelect.mockReturnValue(chain);

			const result = await getProjectWorkStats('proj-1');

			expect(result).toEqual(mockStats);
		});

		it('applies dateFrom filter when provided', async () => {
			const chain = buildSelectChain();
			chain.limit.mockResolvedValue([]);
			mockSelect.mockReturnValue(chain);

			await getProjectWorkStats('proj-1', { dateFrom: new Date('2024-01-01') });

			expect(mockSelect).toHaveBeenCalled();
		});

		it('applies agentType filter when provided', async () => {
			const chain = buildSelectChain();
			chain.limit.mockResolvedValue([]);
			mockSelect.mockReturnValue(chain);

			await getProjectWorkStats('proj-1', { agentType: 'review' });

			expect(mockSelect).toHaveBeenCalled();
		});

		it('applies status filter when provided', async () => {
			const chain = buildSelectChain();
			chain.limit.mockResolvedValue([]);
			mockSelect.mockReturnValue(chain);

			await getProjectWorkStats('proj-1', { status: 'failed' });

			expect(mockSelect).toHaveBeenCalled();
		});
	});

	describe('getProjectWorkStatsAggregated', () => {
		function setupAggregatedChains(agentRows: unknown[]) {
			// Subquery chain
			const subChain = buildSelectChain();
			const subqueryRef = {
				agentType: 'agent_type',
				status: 'status',
				durationMs: 'duration_ms',
				costUsd: 'cost_usd',
			};
			const mockAs = vi.fn().mockReturnValue(subqueryRef);
			subChain.limit.mockReturnValue({ as: mockAs });

			// Aggregate chain
			const aggChain = buildSelectChain();
			aggChain.groupBy.mockResolvedValue(agentRows);

			mockSelect.mockReturnValueOnce(subChain).mockReturnValueOnce(aggChain);

			return { subChain, aggChain };
		}

		it('returns empty summary when no rows', async () => {
			setupAggregatedChains([]);

			const result = await getProjectWorkStatsAggregated('proj-1');

			expect(result.summary.totalRuns).toBe(0);
			expect(result.summary.completedRuns).toBe(0);
			expect(result.summary.failedRuns).toBe(0);
			expect(result.summary.timedOutRuns).toBe(0);
			expect(result.summary.successRate).toBe(0);
			expect(result.summary.avgDurationMs).toBeNull();
			expect(result.byAgentType).toEqual([]);
		});

		it('computes correct totals across agent types', async () => {
			const agentRows = [
				{
					agentType: 'implementation',
					runCount: 10,
					completedCount: 8,
					failedCount: 2,
					timedOutCount: 0,
					totalCostUsd: '1.2000',
					totalDurationMs: 600000,
					durationRunCount: 8,
					avgDurationMs: 75000,
				},
				{
					agentType: 'review',
					runCount: 5,
					completedCount: 5,
					failedCount: 0,
					timedOutCount: 0,
					totalCostUsd: '0.5000',
					totalDurationMs: 150000,
					durationRunCount: 5,
					avgDurationMs: 30000,
				},
			];
			setupAggregatedChains(agentRows);

			const result = await getProjectWorkStatsAggregated('proj-1');

			expect(result.summary.totalRuns).toBe(15);
			expect(result.summary.completedRuns).toBe(13);
			expect(result.summary.failedRuns).toBe(2);
			expect(result.summary.timedOutRuns).toBe(0);
			expect(result.byAgentType).toHaveLength(2);
		});

		it('computes correct totalCostUsd in summary', async () => {
			setupAggregatedChains([
				{
					agentType: 'implementation',
					runCount: 2,
					completedCount: 2,
					failedCount: 0,
					timedOutCount: 0,
					totalCostUsd: '0.5000',
					totalDurationMs: 60000,
					durationRunCount: 2,
					avgDurationMs: 30000,
				},
				{
					agentType: 'review',
					runCount: 1,
					completedCount: 1,
					failedCount: 0,
					timedOutCount: 0,
					totalCostUsd: '0.2500',
					totalDurationMs: 30000,
					durationRunCount: 1,
					avgDurationMs: 30000,
				},
			]);

			const result = await getProjectWorkStatsAggregated('proj-1');

			expect(result.summary.totalCostUsd).toBe('0.7500');
		});

		it('handles null avgDurationMs gracefully', async () => {
			setupAggregatedChains([
				{
					agentType: 'implementation',
					runCount: 2,
					completedCount: 1,
					failedCount: 1,
					timedOutCount: 0,
					totalCostUsd: '0.0000',
					totalDurationMs: 0,
					durationRunCount: 0,
					avgDurationMs: null,
				},
			]);

			const result: AggregatedProjectStats = await getProjectWorkStatsAggregated('proj-1');

			expect(result.summary.avgDurationMs).toBeNull();
			expect(result.byAgentType[0].avgDurationMs).toBeNull();
		});

		it('returns 100% success rate when all runs completed', async () => {
			setupAggregatedChains([
				{
					agentType: 'implementation',
					runCount: 5,
					completedCount: 5,
					failedCount: 0,
					timedOutCount: 0,
					totalCostUsd: '1.0000',
					totalDurationMs: 300000,
					durationRunCount: 5,
					avgDurationMs: 60000,
				},
			]);

			const result = await getProjectWorkStatsAggregated('proj-1');

			expect(result.summary.successRate).toBe(100);
		});

		it('applies filters when provided', async () => {
			setupAggregatedChains([]);

			await getProjectWorkStatsAggregated('proj-1', {
				dateFrom: new Date('2024-01-01'),
				agentType: 'review',
				status: 'completed',
			});

			expect(mockSelect).toHaveBeenCalledTimes(2);
		});
	});
});

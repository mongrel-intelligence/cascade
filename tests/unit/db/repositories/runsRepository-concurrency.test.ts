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
	agentRunLogs: { runId: 'run_id' },
	agentRunLlmCalls: {
		id: 'id',
		runId: 'run_id',
		callNumber: 'call_number',
	},
	debugAnalyses: { id: 'id', analyzedRunId: 'analyzed_run_id', debugRunId: 'debug_run_id' },
	projects: { id: 'id', orgId: 'org_id', name: 'name' },
	organizations: { id: 'id', name: 'name' },
}));

vi.mock('../../../../src/db/repositories/joinHelpers.js', () => ({
	buildAgentRunWorkItemJoin: () => 'mock-join-condition',
}));

vi.mock('../../../../src/db/repositories/llmCallsRepository.js', () => ({
	storeLlmCall: vi.fn(),
	storeLlmCallsBulk: vi.fn(),
	getLlmCallsByRunId: vi.fn(),
	getLlmCallByNumber: vi.fn(),
	listLlmCallsMeta: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/debugAnalysisRepository.js', () => ({
	storeDebugAnalysis: vi.fn(),
	getDebugAnalysisByRunId: vi.fn(),
	deleteDebugAnalysisByRunId: vi.fn(),
	getDebugAnalysisByDebugRunId: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/runLogsRepository.js', () => ({
	storeRunLogs: vi.fn(),
	getRunLogs: vi.fn(),
}));

vi.mock('../../../../src/db/repositories/runStatsRepository.js', () => ({
	listRuns: vi.fn(),
	listProjectsForOrg: vi.fn(),
	getRunsByWorkItem: vi.fn(),
	getRunsForPR: vi.fn(),
	getProjectWorkStats: vi.fn(),
	getProjectWorkStatsAggregated: vi.fn(),
}));

import {
	cancelRunById,
	countActiveRuns,
	failOrphanedRun,
	failOrphanedRunFallback,
	hasActiveRunForWorkItem,
} from '../../../../src/db/repositories/runsRepository.js';
import { mockGetDb } from '../../../helpers/sharedMocks.js';

// ============================================================================
// Test helpers
// ============================================================================

function buildMockDb() {
	const mockInsert = vi.fn();
	const mockUpdate = vi.fn();
	const mockSelect = vi.fn();
	const mockDelete = vi.fn();
	const mockValues = vi.fn();
	const mockReturning = vi.fn();
	const mockSet = vi.fn();
	const mockWhere = vi.fn();
	const mockFrom = vi.fn();
	const mockOrderBy = vi.fn();
	const mockLimit = vi.fn();

	mockInsert.mockReturnValue({ values: mockValues });
	mockValues.mockReturnValue({ returning: mockReturning });
	mockUpdate.mockReturnValue({ set: mockSet });
	mockSet.mockReturnValue({ where: mockWhere });
	mockWhere.mockResolvedValue([]);
	mockSelect.mockReturnValue({ from: mockFrom });
	mockFrom.mockReturnValue({ where: mockWhere });
	mockOrderBy.mockReturnValue({ limit: mockLimit });

	const db = {
		insert: mockInsert,
		update: mockUpdate,
		select: mockSelect,
		delete: mockDelete,
	};

	mockGetDb.mockReturnValue(db as never);

	return {
		db,
		chain: {
			insert: mockInsert,
			update: mockUpdate,
			select: mockSelect,
			delete: mockDelete,
			values: mockValues,
			returning: mockReturning,
			set: mockSet,
			where: mockWhere,
			from: mockFrom,
			orderBy: mockOrderBy,
			limit: mockLimit,
		},
	};
}

describe('runsRepository - concurrency functions', () => {
	describe('countActiveRuns', () => {
		let mocks: ReturnType<typeof buildMockDb>;

		beforeEach(() => {
			mocks = buildMockDb();
			mocks.chain.where.mockResolvedValue([{ count: 0 }]);
		});

		it('returns count for projectId only (base condition)', async () => {
			mocks.chain.where.mockResolvedValueOnce([{ count: 3 }]);

			const result = await countActiveRuns({ projectId: 'proj-1' });

			expect(result).toBe(3);
			expect(mocks.db.select).toHaveBeenCalled();
		});

		it('returns count for projectId + workItemId', async () => {
			mocks.chain.where.mockResolvedValueOnce([{ count: 1 }]);

			const result = await countActiveRuns({ projectId: 'proj-1', workItemId: 'card-1' });

			expect(result).toBe(1);
		});

		it('returns count for projectId + agentType', async () => {
			mocks.chain.where.mockResolvedValueOnce([{ count: 2 }]);

			const result = await countActiveRuns({
				projectId: 'proj-1',
				agentType: 'implementation',
			});

			expect(result).toBe(2);
		});

		it('returns count for projectId + workItemId + agentType', async () => {
			mocks.chain.where.mockResolvedValueOnce([{ count: 1 }]);

			const result = await countActiveRuns({
				projectId: 'proj-1',
				workItemId: 'card-1',
				agentType: 'implementation',
			});

			expect(result).toBe(1);
		});

		it('accepts maxAgeMs and applies date cutoff condition', async () => {
			mocks.chain.where.mockResolvedValueOnce([{ count: 0 }]);

			const result = await countActiveRuns({ projectId: 'proj-1', maxAgeMs: 3600000 });

			expect(result).toBe(0);
		});

		it('returns 0 when count row is missing', async () => {
			mocks.chain.where.mockResolvedValueOnce([]);

			const result = await countActiveRuns({ projectId: 'proj-1' });

			expect(result).toBe(0);
		});

		it('returns 0 when row has undefined count', async () => {
			mocks.chain.where.mockResolvedValueOnce([undefined]);

			const result = await countActiveRuns({ projectId: 'proj-1' });

			expect(result).toBe(0);
		});
	});

	describe('hasActiveRunForWorkItem', () => {
		let mocks: ReturnType<typeof buildMockDb>;

		beforeEach(() => {
			mocks = buildMockDb();
		});

		it('returns true when count > 0', async () => {
			mocks.chain.where.mockResolvedValueOnce([{ count: 1 }]);

			const result = await hasActiveRunForWorkItem('proj-1', 'card-1');

			expect(result).toBe(true);
		});

		it('returns false when count is 0', async () => {
			mocks.chain.where.mockResolvedValueOnce([{ count: 0 }]);

			const result = await hasActiveRunForWorkItem('proj-1', 'card-1');

			expect(result).toBe(false);
		});

		it('returns false when count row is missing', async () => {
			mocks.chain.where.mockResolvedValueOnce([]);

			const result = await hasActiveRunForWorkItem('proj-1', 'card-1');

			expect(result).toBe(false);
		});

		it('accepts optional maxAgeMs parameter', async () => {
			mocks.chain.where.mockResolvedValueOnce([{ count: 2 }]);

			const result = await hasActiveRunForWorkItem('proj-1', 'card-1', 3600000);

			expect(result).toBe(true);
		});
	});

	describe('failOrphanedRun', () => {
		let mocks: ReturnType<typeof buildMockDb>;

		beforeEach(() => {
			mocks = buildMockDb();
		});

		it('returns null when no running run found', async () => {
			const mockLimitNoResult = vi.fn().mockResolvedValue([]);
			mocks.chain.orderBy.mockReturnValue({ limit: mockLimitNoResult });
			mocks.chain.where.mockReturnValue({ orderBy: mocks.chain.orderBy });

			const result = await failOrphanedRun('proj-1', 'card-1', 'Container died');

			expect(result).toBeNull();
			expect(mocks.db.update).not.toHaveBeenCalled();
		});

		it('updates status to failed and returns the run id', async () => {
			const mockLimitForSelect = vi.fn().mockResolvedValue([{ id: 'run-orphan-1' }]);
			mocks.chain.orderBy.mockReturnValue({ limit: mockLimitForSelect });
			mocks.chain.where.mockReturnValue({ orderBy: mocks.chain.orderBy });

			// UPDATE returning
			const mockReturningForUpdate = vi.fn().mockResolvedValue([{ id: 'run-orphan-1' }]);
			const mockWhereForUpdate = vi.fn().mockReturnValue({ returning: mockReturningForUpdate });
			mocks.chain.set.mockReturnValue({ where: mockWhereForUpdate });

			const result = await failOrphanedRun('proj-1', 'card-1', 'Container died');

			expect(result).toBe('run-orphan-1');
			expect(mocks.db.update).toHaveBeenCalled();
			expect(mocks.chain.set).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'failed',
					error: 'Container died',
				}),
			);
		});

		it('accepts timed_out status', async () => {
			const mockLimitForSelect = vi.fn().mockResolvedValue([{ id: 'run-1' }]);
			mocks.chain.orderBy.mockReturnValue({ limit: mockLimitForSelect });
			mocks.chain.where.mockReturnValue({ orderBy: mocks.chain.orderBy });

			const mockReturningForUpdate = vi.fn().mockResolvedValue([{ id: 'run-1' }]);
			const mockWhereForUpdate = vi.fn().mockReturnValue({ returning: mockReturningForUpdate });
			mocks.chain.set.mockReturnValue({ where: mockWhereForUpdate });

			const result = await failOrphanedRun('proj-1', 'card-1', 'Timeout', 'timed_out');

			expect(result).toBe('run-1');
			expect(mocks.chain.set).toHaveBeenCalledWith(
				expect.objectContaining({ status: 'timed_out' }),
			);
		});

		it('returns null when concurrent update wins (update matches nothing)', async () => {
			const mockLimitForSelect = vi.fn().mockResolvedValue([{ id: 'run-orphan-2' }]);
			mocks.chain.orderBy.mockReturnValue({ limit: mockLimitForSelect });
			mocks.chain.where.mockReturnValue({ orderBy: mocks.chain.orderBy });

			const mockReturningForUpdate = vi.fn().mockResolvedValue([]);
			const mockWhereForUpdate = vi.fn().mockReturnValue({ returning: mockReturningForUpdate });
			mocks.chain.set.mockReturnValue({ where: mockWhereForUpdate });

			const result = await failOrphanedRun('proj-1', 'card-1', 'Died');

			expect(result).toBeNull();
		});

		it('passes durationMs to the update', async () => {
			const mockLimitForSelect = vi.fn().mockResolvedValue([{ id: 'run-1' }]);
			mocks.chain.orderBy.mockReturnValue({ limit: mockLimitForSelect });
			mocks.chain.where.mockReturnValue({ orderBy: mocks.chain.orderBy });

			const mockReturningForUpdate = vi.fn().mockResolvedValue([{ id: 'run-1' }]);
			const mockWhereForUpdate = vi.fn().mockReturnValue({ returning: mockReturningForUpdate });
			mocks.chain.set.mockReturnValue({ where: mockWhereForUpdate });

			await failOrphanedRun('proj-1', 'card-1', 'Died', 'failed', 5000);

			expect(mocks.chain.set).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 5000 }));
		});
	});

	describe('failOrphanedRunFallback', () => {
		let mocks: ReturnType<typeof buildMockDb>;

		beforeEach(() => {
			mocks = buildMockDb();
		});

		it('returns null when no matching run found', async () => {
			const mockLimitForSelect = vi.fn().mockResolvedValue([]);
			mocks.chain.orderBy.mockReturnValue({ limit: mockLimitForSelect });
			mocks.chain.where.mockReturnValue({ orderBy: mocks.chain.orderBy });

			const result = await failOrphanedRunFallback(
				'proj-1',
				'implementation',
				new Date('2024-01-01'),
				'failed',
				'Worker died',
			);

			expect(result).toBeNull();
		});

		it('updates the run and returns its id', async () => {
			const mockLimitForSelect = vi.fn().mockResolvedValue([{ id: 'run-fb-1' }]);
			mocks.chain.orderBy.mockReturnValue({ limit: mockLimitForSelect });
			mocks.chain.where.mockReturnValue({ orderBy: mocks.chain.orderBy });

			const mockReturningForUpdate = vi.fn().mockResolvedValue([{ id: 'run-fb-1' }]);
			const mockWhereForUpdate = vi.fn().mockReturnValue({ returning: mockReturningForUpdate });
			mocks.chain.set.mockReturnValue({ where: mockWhereForUpdate });

			const result = await failOrphanedRunFallback(
				'proj-1',
				undefined,
				new Date('2024-01-01'),
				'timed_out',
				'Container died',
				3000,
			);

			expect(result).toBe('run-fb-1');
			expect(mocks.chain.set).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'timed_out',
					error: 'Container died',
					durationMs: 3000,
				}),
			);
		});

		it('includes agentType condition when provided', async () => {
			const mockLimitForSelect = vi.fn().mockResolvedValue([]);
			mocks.chain.orderBy.mockReturnValue({ limit: mockLimitForSelect });
			mocks.chain.where.mockReturnValue({ orderBy: mocks.chain.orderBy });

			await failOrphanedRunFallback('proj-1', 'implementation', new Date(), 'failed', 'Reason');

			expect(mocks.db.select).toHaveBeenCalled();
		});
	});

	describe('cancelRunById', () => {
		let mocks: ReturnType<typeof buildMockDb>;

		beforeEach(() => {
			mocks = buildMockDb();
		});

		it('returns true when run is successfully cancelled', async () => {
			const mockReturningForUpdate = vi.fn().mockResolvedValue([{ id: 'run-1' }]);
			const mockWhereForUpdate = vi.fn().mockReturnValue({ returning: mockReturningForUpdate });
			mocks.chain.set.mockReturnValue({ where: mockWhereForUpdate });

			const result = await cancelRunById('run-1', 'Cancelled by user');

			expect(result).toBe(true);
			expect(mocks.chain.set).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'failed',
					error: 'Cancelled by user',
				}),
			);
		});

		it('sets completedAt when cancelling', async () => {
			const mockReturningForUpdate = vi.fn().mockResolvedValue([{ id: 'run-1' }]);
			const mockWhereForUpdate = vi.fn().mockReturnValue({ returning: mockReturningForUpdate });
			mocks.chain.set.mockReturnValue({ where: mockWhereForUpdate });

			await cancelRunById('run-1', 'User cancelled');

			const setArg = mocks.chain.set.mock.calls[0][0];
			expect(setArg.completedAt).toBeInstanceOf(Date);
		});

		it('returns false when run is not in running state', async () => {
			const mockReturningForUpdate = vi.fn().mockResolvedValue([]);
			const mockWhereForUpdate = vi.fn().mockReturnValue({ returning: mockReturningForUpdate });
			mocks.chain.set.mockReturnValue({ where: mockWhereForUpdate });

			const result = await cancelRunById('run-completed', 'Trying to cancel');

			expect(result).toBe(false);
		});
	});
});

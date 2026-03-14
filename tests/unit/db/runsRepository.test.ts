import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the database client
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
const mockOffset = vi.fn();
const mockInnerJoin = vi.fn();

vi.mock('../../../src/db/client.js', () => ({
	getDb: () => ({
		insert: mockInsert,
		update: mockUpdate,
		select: mockSelect,
		delete: mockDelete,
	}),
}));

vi.mock('../../../src/db/schema/index.js', () => ({
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
	agentRunLogs: { runId: 'run_id' },
	agentRunLlmCalls: {
		runId: 'run_id',
		callNumber: 'call_number',
		id: 'id',
		inputTokens: 'input_tokens',
		outputTokens: 'output_tokens',
		cachedTokens: 'cached_tokens',
		costUsd: 'cost_usd',
		durationMs: 'duration_ms',
		model: 'model',
		createdAt: 'created_at',
	},
	debugAnalyses: { id: 'id', analyzedRunId: 'analyzed_run_id', debugRunId: 'debug_run_id' },
	prWorkItems: {
		projectId: 'project_id',
		prNumber: 'pr_number',
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

vi.mock('../../../src/db/repositories/joinHelpers.js', () => ({
	buildAgentRunWorkItemJoin: () => 'mock-join-condition',
}));

import {
	cancelRunById,
	completeRun,
	countActiveRuns,
	createRun,
	deleteDebugAnalysisByRunId,
	failOrphanedRun,
	getDebugAnalysisByDebugRunId,
	getDebugAnalysisByRunId,
	getLlmCallByNumber,
	getLlmCallsByRunId,
	getRunById,
	getRunLogs,
	getRunsByProjectId,
	getRunsByWorkItem,
	getRunsByWorkItemId,
	getRunsForPR,
	hasActiveRunForWorkItem,
	listLlmCallsMeta,
	listProjectsForOrg,
	listRuns,
	storeDebugAnalysis,
	storeLlmCall,
	storeLlmCallsBulk,
	storeRunLogs,
} from '../../../src/db/repositories/runsRepository.js';

describe('runsRepository', () => {
	// Additional mock for leftJoin (used by getRunById, getRunsByWorkItem, getRunsForPR)
	const mockLeftJoin = vi.fn();

	beforeEach(() => {
		vi.resetAllMocks();

		// Set up chained mock returns
		mockInsert.mockReturnValue({ values: mockValues });
		mockValues.mockReturnValue({ returning: mockReturning });
		mockUpdate.mockReturnValue({ set: mockSet });
		mockSet.mockReturnValue({ where: mockWhere });
		mockSelect.mockReturnValue({ from: mockFrom });
		mockFrom.mockReturnValue({
			where: mockWhere,
			orderBy: mockOrderBy,
			leftJoin: mockLeftJoin,
			innerJoin: mockInnerJoin,
		});
		mockLeftJoin.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy });
		mockInnerJoin.mockReturnValue({
			leftJoin: mockLeftJoin,
			where: mockWhere,
			orderBy: mockOrderBy,
		});
		mockWhere.mockReturnValue({
			orderBy: mockOrderBy,
			limit: mockLimit,
			returning: mockReturning,
		});
		mockDelete.mockReturnValue({ where: mockWhere });
		mockOrderBy.mockReturnValue({ limit: mockLimit, offset: mockOffset });
		mockLimit.mockReturnValue({ offset: mockOffset });
		mockOffset.mockReturnValue([]);
	});

	describe('createRun', () => {
		it('inserts a run and returns the id', async () => {
			mockReturning.mockResolvedValue([{ id: 'run-uuid-1' }]);

			const result = await createRun({
				projectId: 'proj-1',
				workItemId: 'card-1',
				agentType: 'implementation',
				engine: 'llmist',
				triggerType: 'card-moved-to-todo',
				model: 'claude-3',
				maxIterations: 20,
			});

			expect(result).toBe('run-uuid-1');
			expect(mockInsert).toHaveBeenCalled();
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-1',
					workItemId: 'card-1',
					agentType: 'implementation',
					engine: 'llmist',
					status: 'running',
				}),
			);
		});

		it('inserts with optional fields undefined', async () => {
			mockReturning.mockResolvedValue([{ id: 'run-uuid-2' }]);

			const result = await createRun({
				projectId: 'proj-1',
				agentType: 'splitting',
				engine: 'claude-code',
			});

			expect(result).toBe('run-uuid-2');
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-1',
					agentType: 'splitting',
					engine: 'claude-code',
					status: 'running',
					workItemId: undefined,
					prNumber: undefined,
				}),
			);
		});
	});

	describe('completeRun', () => {
		it('updates run with completion data', async () => {
			mockWhere.mockResolvedValue(undefined);

			await completeRun('run-1', {
				status: 'completed',
				durationMs: 5000,
				llmIterations: 10,
				gadgetCalls: 5,
				costUsd: 0.123456,
				success: true,
				prUrl: 'https://github.com/owner/repo/pull/42',
				outputSummary: 'Summary text',
			});

			expect(mockUpdate).toHaveBeenCalled();
			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'completed',
					durationMs: 5000,
					llmIterations: 10,
					success: true,
					costUsd: '0.123456',
					prUrl: 'https://github.com/owner/repo/pull/42',
				}),
			);
		});

		it('updates run with failure data', async () => {
			mockWhere.mockResolvedValue(undefined);

			await completeRun('run-1', {
				status: 'failed',
				durationMs: 2000,
				success: false,
				error: 'Something went wrong',
			});

			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'failed',
					success: false,
					error: 'Something went wrong',
				}),
			);
		});

		it('handles timed_out status', async () => {
			mockWhere.mockResolvedValue(undefined);

			await completeRun('run-1', {
				status: 'timed_out',
				success: false,
				error: 'Watchdog timeout',
			});

			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'timed_out',
					error: 'Watchdog timeout',
				}),
			);
		});
	});

	describe('getRunById', () => {
		it('returns run when found', async () => {
			const mockRun = { id: 'run-1', agentType: 'implementation', status: 'completed' };
			mockWhere.mockResolvedValue([mockRun]);

			const result = await getRunById('run-1');
			expect(result).toEqual(mockRun);
		});

		it('returns null when not found', async () => {
			mockWhere.mockResolvedValue([]);

			const result = await getRunById('nonexistent');
			expect(result).toBeNull();
		});
	});

	describe('getRunsByWorkItemId', () => {
		it('returns runs ordered by startedAt desc', async () => {
			const mockRuns = [
				{ id: 'run-2', workItemId: 'card-1' },
				{ id: 'run-1', workItemId: 'card-1' },
			];
			mockOrderBy.mockResolvedValue(mockRuns);

			const result = await getRunsByWorkItemId('card-1');
			expect(result).toEqual(mockRuns);
		});
	});

	describe('getRunsByProjectId', () => {
		it('returns runs for project', async () => {
			const mockRuns = [{ id: 'run-1', projectId: 'proj-1' }];
			mockOrderBy.mockResolvedValue(mockRuns);

			const result = await getRunsByProjectId('proj-1');
			expect(result).toEqual(mockRuns);
		});
	});

	describe('storeRunLogs', () => {
		it('inserts log records', async () => {
			mockValues.mockResolvedValue(undefined);

			await storeRunLogs('run-1', 'cascade log text', 'llmist log text');

			expect(mockValues).toHaveBeenCalledWith({
				runId: 'run-1',
				cascadeLog: 'cascade log text',
				engineLog: 'llmist log text',
			});
		});

		it('handles undefined logs as null', async () => {
			mockValues.mockResolvedValue(undefined);

			await storeRunLogs('run-1');

			expect(mockValues).toHaveBeenCalledWith({
				runId: 'run-1',
				cascadeLog: null,
				engineLog: null,
			});
		});
	});

	describe('getRunLogs', () => {
		it('returns logs when found', async () => {
			const mockLogs = { runId: 'run-1', cascadeLog: 'log text', engineLog: null };
			mockWhere.mockResolvedValue([mockLogs]);

			const result = await getRunLogs('run-1');
			expect(result).toEqual(mockLogs);
		});

		it('returns null when not found', async () => {
			mockWhere.mockResolvedValue([]);

			const result = await getRunLogs('nonexistent');
			expect(result).toBeNull();
		});
	});

	describe('storeLlmCall', () => {
		it('inserts a single LLM call with all fields', async () => {
			mockValues.mockResolvedValue(undefined);

			await storeLlmCall({
				runId: 'run-1',
				callNumber: 1,
				request: 'What is 2+2?',
				response: '4',
				inputTokens: 100,
				outputTokens: 50,
				cachedTokens: 10,
				costUsd: 0.001,
				durationMs: 500,
				model: 'claude-3-5-sonnet',
			});

			expect(mockInsert).toHaveBeenCalled();
			expect(mockValues).toHaveBeenCalledWith({
				runId: 'run-1',
				callNumber: 1,
				request: 'What is 2+2?',
				response: '4',
				inputTokens: 100,
				outputTokens: 50,
				cachedTokens: 10,
				costUsd: '0.001',
				durationMs: 500,
				model: 'claude-3-5-sonnet',
			});
		});

		it('inserts a single LLM call with only required fields', async () => {
			mockValues.mockResolvedValue(undefined);

			await storeLlmCall({
				runId: 'run-1',
				callNumber: 2,
			});

			expect(mockValues).toHaveBeenCalledWith({
				runId: 'run-1',
				callNumber: 2,
				request: undefined,
				response: undefined,
				inputTokens: undefined,
				outputTokens: undefined,
				cachedTokens: undefined,
				costUsd: undefined,
				durationMs: undefined,
				model: undefined,
			});
		});
	});

	describe('storeLlmCallsBulk', () => {
		it('inserts multiple LLM call records', async () => {
			mockValues.mockResolvedValue(undefined);

			await storeLlmCallsBulk([
				{
					runId: 'run-1',
					callNumber: 1,
					request: 'req1',
					response: 'res1',
					inputTokens: 100,
					outputTokens: 50,
					costUsd: 0.001,
				},
				{
					runId: 'run-1',
					callNumber: 2,
					request: 'req2',
					response: 'res2',
					inputTokens: 200,
					outputTokens: 100,
					costUsd: 0.002,
				},
			]);

			expect(mockInsert).toHaveBeenCalled();
			expect(mockValues).toHaveBeenCalledWith([
				expect.objectContaining({
					runId: 'run-1',
					callNumber: 1,
					costUsd: '0.001',
				}),
				expect.objectContaining({
					runId: 'run-1',
					callNumber: 2,
					costUsd: '0.002',
				}),
			]);
		});

		it('skips insert when calls array is empty', async () => {
			await storeLlmCallsBulk([]);
			expect(mockInsert).not.toHaveBeenCalled();
		});
	});

	describe('getLlmCallsByRunId', () => {
		it('returns LLM calls ordered by call number', async () => {
			const mockCalls = [
				{ runId: 'run-1', callNumber: 1 },
				{ runId: 'run-1', callNumber: 2 },
			];
			mockOrderBy.mockResolvedValue(mockCalls);

			const result = await getLlmCallsByRunId('run-1');
			expect(result).toEqual(mockCalls);
		});
	});

	describe('storeDebugAnalysis', () => {
		it('inserts debug analysis and returns id', async () => {
			mockReturning.mockResolvedValue([{ id: 'debug-uuid-1' }]);

			const result = await storeDebugAnalysis({
				analyzedRunId: 'run-1',
				debugRunId: 'debug-run-1',
				summary: 'The agent failed due to...',
				issues: 'Issue 1, Issue 2',
				timeline: 'Step 1, Step 2',
				rootCause: 'Missing config',
				recommendations: 'Add config',
				severity: 'failure',
			});

			expect(result).toBe('debug-uuid-1');
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					analyzedRunId: 'run-1',
					debugRunId: 'debug-run-1',
					summary: 'The agent failed due to...',
				}),
			);
		});
	});

	describe('getDebugAnalysisByRunId', () => {
		it('returns analysis when found', async () => {
			const mockAnalysis = { id: 'da-1', analyzedRunId: 'run-1', summary: 'Analysis' };
			mockWhere.mockResolvedValue([mockAnalysis]);

			const result = await getDebugAnalysisByRunId('run-1');
			expect(result).toEqual(mockAnalysis);
		});

		it('returns null when not found', async () => {
			mockWhere.mockResolvedValue([]);

			const result = await getDebugAnalysisByRunId('nonexistent');
			expect(result).toBeNull();
		});
	});

	describe('getDebugAnalysisByDebugRunId', () => {
		it('returns analysis by debug run id', async () => {
			const mockAnalysis = { id: 'da-1', debugRunId: 'debug-run-1' };
			mockWhere.mockResolvedValue([mockAnalysis]);

			const result = await getDebugAnalysisByDebugRunId('debug-run-1');
			expect(result).toEqual(mockAnalysis);
		});

		it('returns null when not found', async () => {
			mockWhere.mockResolvedValue([]);

			const result = await getDebugAnalysisByDebugRunId('nonexistent');
			expect(result).toBeNull();
		});
	});

	describe('deleteDebugAnalysisByRunId', () => {
		it('calls delete with the correct analyzedRunId', async () => {
			mockWhere.mockResolvedValue(undefined);

			await deleteDebugAnalysisByRunId('run-1');

			expect(mockDelete).toHaveBeenCalled();
			expect(mockWhere).toHaveBeenCalled();
		});
	});

	describe('countActiveRuns', () => {
		it('returns count for projectId only', async () => {
			mockWhere.mockResolvedValue([{ count: 3 }]);

			const result = await countActiveRuns({ projectId: 'proj-1' });
			expect(result).toBe(3);
			expect(mockSelect).toHaveBeenCalled();
		});

		it('returns count for projectId + workItemId', async () => {
			mockWhere.mockResolvedValue([{ count: 1 }]);

			const result = await countActiveRuns({ projectId: 'proj-1', workItemId: 'card-1' });
			expect(result).toBe(1);
		});

		it('returns count for projectId + agentType', async () => {
			mockWhere.mockResolvedValue([{ count: 2 }]);

			const result = await countActiveRuns({ projectId: 'proj-1', agentType: 'implementation' });
			expect(result).toBe(2);
		});

		it('returns count for projectId + workItemId + agentType', async () => {
			mockWhere.mockResolvedValue([{ count: 1 }]);

			const result = await countActiveRuns({
				projectId: 'proj-1',
				workItemId: 'card-1',
				agentType: 'implementation',
			});
			expect(result).toBe(1);
		});

		it('accepts maxAgeMs and returns 0 when no rows', async () => {
			mockWhere.mockResolvedValue([]);

			const result = await countActiveRuns({ projectId: 'proj-1', maxAgeMs: 3600000 });
			expect(result).toBe(0);
		});

		it('returns 0 when count row is missing', async () => {
			mockWhere.mockResolvedValue([undefined]);

			const result = await countActiveRuns({ projectId: 'proj-1' });
			expect(result).toBe(0);
		});
	});

	describe('hasActiveRunForWorkItem', () => {
		it('returns true when active run exists', async () => {
			mockWhere.mockResolvedValue([{ count: 1 }]);

			const result = await hasActiveRunForWorkItem('proj-1', 'card-1');
			expect(result).toBe(true);
		});

		it('returns false when no active run exists', async () => {
			mockWhere.mockResolvedValue([{ count: 0 }]);

			const result = await hasActiveRunForWorkItem('proj-1', 'card-1');
			expect(result).toBe(false);
		});

		it('returns false when count row is missing', async () => {
			mockWhere.mockResolvedValue([]);

			const result = await hasActiveRunForWorkItem('proj-1', 'card-1');
			expect(result).toBe(false);
		});

		it('accepts optional maxAgeMs parameter', async () => {
			mockWhere.mockResolvedValue([{ count: 2 }]);

			const result = await hasActiveRunForWorkItem('proj-1', 'card-1', 3600000);
			expect(result).toBe(true);
		});
	});

	describe('failOrphanedRun', () => {
		it('returns null when no running run found for work item', async () => {
			// SELECT chain: from → where → orderBy → limit → resolves to []
			const mockLimitNoResult = vi.fn().mockResolvedValue([]);
			mockOrderBy.mockReturnValue({ limit: mockLimitNoResult });

			const result = await failOrphanedRun('proj-1', 'card-1', 'Container died');
			expect(result).toBeNull();
			// No update should be called since no running run found
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		it('updates status to failed and returns the run id when found', async () => {
			// SELECT chain: from → where → orderBy → limit → resolves to [{ id }]
			const mockLimitForSelect = vi.fn().mockResolvedValue([{ id: 'run-orphan-1' }]);
			mockOrderBy.mockReturnValue({ limit: mockLimitForSelect });

			// UPDATE chain: update → set → where → returning → resolves to [{ id }]
			const mockReturningForUpdate = vi.fn().mockResolvedValue([{ id: 'run-orphan-1' }]);
			const mockWhereForUpdate = vi.fn().mockReturnValue({ returning: mockReturningForUpdate });
			mockSet.mockReturnValue({ where: mockWhereForUpdate });

			const result = await failOrphanedRun('proj-1', 'card-1', 'Container died');
			expect(result).toBe('run-orphan-1');
			expect(mockUpdate).toHaveBeenCalled();
			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'failed',
					error: 'Container died',
				}),
			);
		});

		it('returns null when update does not match (concurrent update)', async () => {
			// SELECT chain: resolves to a running run
			const mockLimitForSelect = vi.fn().mockResolvedValue([{ id: 'run-orphan-2' }]);
			mockOrderBy.mockReturnValue({ limit: mockLimitForSelect });

			// UPDATE chain: another process already updated it, so returning is empty
			const mockReturningForUpdate = vi.fn().mockResolvedValue([]);
			const mockWhereForUpdate = vi.fn().mockReturnValue({ returning: mockReturningForUpdate });
			mockSet.mockReturnValue({ where: mockWhereForUpdate });

			const result = await failOrphanedRun('proj-1', 'card-1', 'Container died');
			expect(result).toBeNull();
		});
	});

	describe('cancelRunById', () => {
		it('returns true when a running run is successfully cancelled', async () => {
			// UPDATE chain: update → set → where → returning → resolves to [{ id }]
			const mockReturningForUpdate = vi.fn().mockResolvedValue([{ id: 'run-1' }]);
			const mockWhereForUpdate = vi.fn().mockReturnValue({ returning: mockReturningForUpdate });
			mockSet.mockReturnValue({ where: mockWhereForUpdate });

			const result = await cancelRunById('run-1', 'Cancelled by user');
			expect(result).toBe(true);
			expect(mockUpdate).toHaveBeenCalled();
			expect(mockSet).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'failed',
					error: 'Cancelled by user',
				}),
			);
		});

		it('returns false when run is already completed (not running)', async () => {
			// Update matches nothing because it's not in 'running' status
			const mockReturningForUpdate = vi.fn().mockResolvedValue([]);
			const mockWhereForUpdate = vi.fn().mockReturnValue({ returning: mockReturningForUpdate });
			mockSet.mockReturnValue({ where: mockWhereForUpdate });

			const result = await cancelRunById('run-2', 'Cancelled');
			expect(result).toBe(false);
		});
	});

	describe('listRuns', () => {
		// listRuns uses Promise.all with 2 parallel queries (data + count)
		// We need to set up both query chains
		const mockDataWhere = vi.fn();
		const mockCountWhere = vi.fn();
		const mockDataOrderBy = vi.fn();
		const mockDataLimit = vi.fn();
		const mockDataOffset = vi.fn();
		const mockDataInnerJoin = vi.fn();
		const mockDataLeftJoin2 = vi.fn();
		const mockCountInnerJoin = vi.fn();

		beforeEach(() => {
			// First select call (data query): select(...).from(...).innerJoin(...).innerJoin(...).leftJoin(...).where(...).orderBy(...).limit(...).offset(...)
			const mockDataInnerJoin2 = vi.fn();
			mockDataInnerJoin.mockReturnValue({ innerJoin: mockDataInnerJoin2 });
			mockDataInnerJoin2.mockReturnValue({ leftJoin: mockDataLeftJoin2 });
			mockDataLeftJoin2.mockReturnValue({ where: mockDataWhere });

			mockDataWhere.mockReturnValue({ orderBy: mockDataOrderBy });
			mockDataOrderBy.mockReturnValue({ limit: mockDataLimit });
			mockDataLimit.mockReturnValue({ offset: mockDataOffset });
			mockDataOffset.mockResolvedValue([]);

			// Second select call (count query): select(...).from(...).innerJoin(...).where(...)
			mockCountInnerJoin.mockReturnValue({ where: mockCountWhere });
			mockCountWhere.mockResolvedValue([{ total: 0 }]);

			// Wire up mockFrom to return different chains for each invocation
			mockFrom
				.mockReturnValueOnce({
					innerJoin: mockDataInnerJoin,
					where: mockDataWhere,
					orderBy: mockDataOrderBy,
					leftJoin: mockLeftJoin,
				})
				.mockReturnValueOnce({
					innerJoin: mockCountInnerJoin,
					where: mockCountWhere,
				});
		});

		it('returns data and total with default sort/order', async () => {
			const mockRuns = [{ id: 'run-1', projectId: 'proj-1' }];
			mockDataOffset.mockResolvedValue(mockRuns);
			mockCountWhere.mockResolvedValue([{ total: 1 }]);

			const result = await listRuns({
				orgId: 'org-1',
				limit: 10,
				offset: 0,
			});

			expect(result.data).toEqual(mockRuns);
			expect(result.total).toBe(1);
			expect(mockSelect).toHaveBeenCalledTimes(2);
		});

		it('passes projectId filter when provided', async () => {
			mockDataOffset.mockResolvedValue([]);
			mockCountWhere.mockResolvedValue([{ total: 0 }]);

			await listRuns({
				orgId: 'org-1',
				projectId: 'proj-1',
				limit: 10,
				offset: 0,
			});

			expect(mockSelect).toHaveBeenCalledTimes(2);
		});

		it('passes status filter when provided', async () => {
			mockDataOffset.mockResolvedValue([]);
			mockCountWhere.mockResolvedValue([{ total: 0 }]);

			await listRuns({
				orgId: 'org-1',
				status: ['running', 'failed'],
				limit: 10,
				offset: 0,
			});

			expect(mockSelect).toHaveBeenCalledTimes(2);
		});

		it('passes agentType filter when provided', async () => {
			mockDataOffset.mockResolvedValue([]);
			mockCountWhere.mockResolvedValue([{ total: 0 }]);

			await listRuns({
				orgId: 'org-1',
				agentType: 'implementation',
				limit: 10,
				offset: 0,
			});

			expect(mockSelect).toHaveBeenCalledTimes(2);
		});

		it('passes date range filters when provided', async () => {
			mockDataOffset.mockResolvedValue([]);
			mockCountWhere.mockResolvedValue([{ total: 0 }]);

			await listRuns({
				orgId: 'org-1',
				startedAfter: new Date('2024-01-01'),
				startedBefore: new Date('2024-12-31'),
				limit: 20,
				offset: 0,
			});

			expect(mockSelect).toHaveBeenCalledTimes(2);
		});

		it('handles sort by durationMs asc', async () => {
			mockDataOffset.mockResolvedValue([]);
			mockCountWhere.mockResolvedValue([{ total: 0 }]);

			await listRuns({
				orgId: 'org-1',
				sort: 'durationMs',
				order: 'asc',
				limit: 10,
				offset: 0,
			});

			expect(mockSelect).toHaveBeenCalledTimes(2);
		});

		it('handles sort by costUsd desc', async () => {
			mockDataOffset.mockResolvedValue([]);
			mockCountWhere.mockResolvedValue([{ total: 0 }]);

			await listRuns({
				orgId: 'org-1',
				sort: 'costUsd',
				order: 'desc',
				limit: 10,
				offset: 0,
			});

			expect(mockSelect).toHaveBeenCalledTimes(2);
		});

		it('returns combined data and total from parallel queries', async () => {
			const mockData = [
				{ id: 'run-1', status: 'completed' },
				{ id: 'run-2', status: 'failed' },
			];
			mockDataOffset.mockResolvedValue(mockData);
			mockCountWhere.mockResolvedValue([{ total: 42 }]);

			const result = await listRuns({
				orgId: 'org-1',
				limit: 2,
				offset: 0,
			});

			expect(result.data).toEqual(mockData);
			expect(result.total).toBe(42);
		});
	});

	describe('getLlmCallByNumber', () => {
		it('returns the LLM call when found', async () => {
			const mockCall = { runId: 'run-1', callNumber: 3, request: 'query', response: 'answer' };
			mockWhere.mockResolvedValue([mockCall]);

			const result = await getLlmCallByNumber('run-1', 3);
			expect(result).toEqual(mockCall);
			expect(mockSelect).toHaveBeenCalled();
		});

		it('returns null when call not found', async () => {
			mockWhere.mockResolvedValue([]);

			const result = await getLlmCallByNumber('run-1', 999);
			expect(result).toBeNull();
		});
	});

	describe('listLlmCallsMeta', () => {
		it('returns ordered meta records for a run (without request/response bodies)', async () => {
			const mockMeta = [
				{
					id: 'call-1',
					runId: 'run-1',
					callNumber: 1,
					inputTokens: 100,
					outputTokens: 50,
					cachedTokens: 0,
					costUsd: '0.001',
					durationMs: 300,
					model: 'claude-3',
					createdAt: new Date(),
				},
				{
					id: 'call-2',
					runId: 'run-1',
					callNumber: 2,
					inputTokens: 200,
					outputTokens: 80,
					cachedTokens: 10,
					costUsd: '0.002',
					durationMs: 500,
					model: 'claude-3',
					createdAt: new Date(),
				},
			];
			mockOrderBy.mockResolvedValue(mockMeta);

			const result = await listLlmCallsMeta('run-1');
			expect(result).toEqual(mockMeta);
			expect(mockSelect).toHaveBeenCalled();
		});

		it('returns empty array when no calls exist', async () => {
			mockOrderBy.mockResolvedValue([]);

			const result = await listLlmCallsMeta('run-no-calls');
			expect(result).toEqual([]);
		});
	});

	describe('listProjectsForOrg', () => {
		it('returns list of projects for an org with id and name', async () => {
			const mockProjects = [
				{ id: 'proj-1', name: 'Project Alpha' },
				{ id: 'proj-2', name: 'Project Beta' },
			];
			mockWhere.mockResolvedValue(mockProjects);

			const result = await listProjectsForOrg('org-1');
			expect(result).toEqual(mockProjects);
			expect(mockSelect).toHaveBeenCalled();
		});

		it('returns empty array when org has no projects', async () => {
			mockWhere.mockResolvedValue([]);

			const result = await listProjectsForOrg('org-empty');
			expect(result).toEqual([]);
		});
	});

	describe('getRunsByWorkItem', () => {
		it('returns enriched runs for a work item ordered by startedAt desc', async () => {
			const mockRuns = [
				{
					id: 'run-2',
					projectId: 'proj-1',
					workItemId: 'card-1',
					workItemUrl: 'https://trello.com/c/abc123',
					workItemTitle: 'Test Card',
					prTitle: 'Fix the thing',
				},
				{
					id: 'run-1',
					projectId: 'proj-1',
					workItemId: 'card-1',
					workItemUrl: null,
					workItemTitle: null,
					prTitle: null,
				},
			];
			mockOrderBy.mockResolvedValue(mockRuns);

			const result = await getRunsByWorkItem('proj-1', 'card-1');
			expect(result).toEqual(mockRuns);
			expect(mockSelect).toHaveBeenCalled();
			// leftJoin is called as leftJoin(table, joinCondition)
			expect(mockLeftJoin).toHaveBeenCalledWith(expect.anything(), 'mock-join-condition');
		});

		it('returns empty array when no runs exist for work item', async () => {
			mockOrderBy.mockResolvedValue([]);

			const result = await getRunsByWorkItem('proj-1', 'nonexistent-card');
			expect(result).toEqual([]);
		});
	});

	describe('getRunsForPR', () => {
		it('returns enriched runs for a PR number ordered by startedAt desc', async () => {
			const mockRuns = [
				{
					id: 'run-3',
					projectId: 'proj-1',
					prNumber: 42,
					workItemUrl: 'https://trello.com/c/abc123',
					workItemTitle: 'Implement feature X',
					prTitle: 'feat: implement X',
				},
			];
			mockOrderBy.mockResolvedValue(mockRuns);

			const result = await getRunsForPR('proj-1', 42);
			expect(result).toEqual(mockRuns);
			expect(mockSelect).toHaveBeenCalled();
			// leftJoin is called as leftJoin(table, joinCondition)
			expect(mockLeftJoin).toHaveBeenCalledWith(expect.anything(), 'mock-join-condition');
		});

		it('returns empty array when no runs exist for PR', async () => {
			mockOrderBy.mockResolvedValue([]);

			const result = await getRunsForPR('proj-1', 9999);
			expect(result).toEqual([]);
		});
	});
});

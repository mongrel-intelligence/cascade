import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDbWithGetDb } from '../../../helpers/mockDb.js';
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
		inputTokens: 'input_tokens',
		outputTokens: 'output_tokens',
		cachedTokens: 'cached_tokens',
		costUsd: 'cost_usd',
		durationMs: 'duration_ms',
		model: 'model',
		createdAt: 'created_at',
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
	completeRun,
	createRun,
	getRunById,
	getRunJobId,
	getRunsByProjectId,
	getRunsByWorkItemId,
	updateRunJobId,
	updateRunPRNumber,
} from '../../../../src/db/repositories/runsRepository.js';

describe('runsRepository - core CRUD', () => {
	let mockDb: ReturnType<typeof createMockDbWithGetDb>;

	// leftJoin support needed for getRunById
	const mockLeftJoin = vi.fn();

	beforeEach(() => {
		mockDb = createMockDbWithGetDb({ withThenable: true });

		// Wire leftJoin into the from chain
		const originalFrom = mockDb.chain.from;
		originalFrom.mockReturnValue({
			where: mockDb.chain.where,
			innerJoin: mockDb.chain.innerJoin,
			leftJoin: mockLeftJoin,
		});
		mockLeftJoin.mockReturnValue({ where: mockDb.chain.where });
	});

	describe('createRun', () => {
		it('inserts a run and returns the id', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 'run-uuid-1' }]);

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
			expect(mockDb.db.insert).toHaveBeenCalled();
			expect(mockDb.chain.values).toHaveBeenCalledWith(
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
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 'run-uuid-2' }]);

			const result = await createRun({
				projectId: 'proj-2',
				agentType: 'splitting',
				engine: 'claude-code',
			});

			expect(result).toBe('run-uuid-2');
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-2',
					agentType: 'splitting',
					engine: 'claude-code',
					status: 'running',
					workItemId: undefined,
					prNumber: undefined,
				}),
			);
		});

		it('sets prNumber when provided', async () => {
			mockDb.chain.returning.mockResolvedValueOnce([{ id: 'run-uuid-3' }]);

			await createRun({
				projectId: 'proj-1',
				prNumber: 42,
				agentType: 'review',
				engine: 'claude-code',
			});

			expect(mockDb.chain.values).toHaveBeenCalledWith(expect.objectContaining({ prNumber: 42 }));
		});
	});

	describe('completeRun', () => {
		it('updates run with completed status and all fields', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

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

			expect(mockDb.db.update).toHaveBeenCalled();
			expect(mockDb.chain.set).toHaveBeenCalledWith(
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

		it('converts costUsd to string representation', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await completeRun('run-1', {
				status: 'completed',
				costUsd: 0.001,
			});

			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.costUsd).toBe('0.001');
		});

		it('sets completedAt to a Date', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await completeRun('run-1', { status: 'failed', success: false });

			const setArg = mockDb.chain.set.mock.calls[0][0];
			expect(setArg.completedAt).toBeInstanceOf(Date);
		});

		it('handles timed_out status', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await completeRun('run-1', {
				status: 'timed_out',
				success: false,
				error: 'Watchdog timeout',
			});

			expect(mockDb.chain.set).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'timed_out',
					error: 'Watchdog timeout',
				}),
			);
		});
	});

	describe('updateRunPRNumber', () => {
		it('calls update with isNull guard on prNumber', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateRunPRNumber('run-1', 42);

			expect(mockDb.db.update).toHaveBeenCalled();
			expect(mockDb.chain.set).toHaveBeenCalledWith({ prNumber: 42 });
			// where() is called to apply the isNull guard
			expect(mockDb.chain.where).toHaveBeenCalled();
		});
	});

	describe('updateRunJobId', () => {
		it('updates the job_id for a run', async () => {
			mockDb.chain.where.mockResolvedValueOnce(undefined);

			await updateRunJobId('run-1', 'job-456');

			expect(mockDb.db.update).toHaveBeenCalled();
			expect(mockDb.chain.set).toHaveBeenCalledWith({ jobId: 'job-456' });
		});
	});

	describe('getRunJobId', () => {
		it('returns jobId when found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ jobId: 'job-789' }]);

			const result = await getRunJobId('run-1');

			expect(result).toBe('job-789');
			expect(mockDb.db.select).toHaveBeenCalled();
		});

		it('returns null when run not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

			const result = await getRunJobId('nonexistent');

			expect(result).toBeNull();
		});

		it('returns null when jobId is null', async () => {
			mockDb.chain.where.mockResolvedValueOnce([{ jobId: null }]);

			const result = await getRunJobId('run-1');

			expect(result).toBeNull();
		});
	});

	describe('getRunById', () => {
		it('returns run when found', async () => {
			const mockRun = { id: 'run-1', agentType: 'implementation', status: 'completed' };
			mockDb.chain.where.mockResolvedValueOnce([mockRun]);

			const result = await getRunById('run-1');

			expect(result).toEqual(mockRun);
			expect(mockLeftJoin).toHaveBeenCalledWith(expect.anything(), 'mock-join-condition');
		});

		it('returns null when not found', async () => {
			mockDb.chain.where.mockResolvedValueOnce([]);

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

			// getRunsByWorkItemId uses .orderBy() as terminal
			const mockOrderBy = vi.fn().mockResolvedValueOnce(mockRuns);
			mockDb.chain.where.mockReturnValueOnce({ orderBy: mockOrderBy });

			const result = await getRunsByWorkItemId('card-1');

			expect(result).toEqual(mockRuns);
			expect(mockDb.db.select).toHaveBeenCalled();
		});
	});

	describe('getRunsByProjectId', () => {
		it('returns runs for project ordered by startedAt desc', async () => {
			const mockRuns = [{ id: 'run-1', projectId: 'proj-1' }];

			const mockOrderBy = vi.fn().mockResolvedValueOnce(mockRuns);
			mockDb.chain.where.mockReturnValueOnce({ orderBy: mockOrderBy });

			const result = await getRunsByProjectId('proj-1');

			expect(result).toEqual(mockRuns);
		});

		it('returns empty array when no runs exist', async () => {
			const mockOrderBy = vi.fn().mockResolvedValueOnce([]);
			mockDb.chain.where.mockReturnValueOnce({ orderBy: mockOrderBy });

			const result = await getRunsByProjectId('empty-proj');

			expect(result).toEqual([]);
		});
	});
});

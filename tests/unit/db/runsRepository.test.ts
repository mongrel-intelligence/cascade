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
		cardId: 'card_id',
		status: 'status',
		startedAt: 'started_at',
	},
	agentRunLogs: { runId: 'run_id' },
	agentRunLlmCalls: { runId: 'run_id', callNumber: 'call_number' },
	debugAnalyses: { id: 'id', analyzedRunId: 'analyzed_run_id', debugRunId: 'debug_run_id' },
}));

import {
	completeRun,
	createRun,
	deleteDebugAnalysisByRunId,
	getDebugAnalysisByDebugRunId,
	getDebugAnalysisByRunId,
	getLlmCallsByRunId,
	getRunById,
	getRunLogs,
	getRunsByCardId,
	getRunsByProjectId,
	storeDebugAnalysis,
	storeLlmCallsBulk,
	storeRunLogs,
} from '../../../src/db/repositories/runsRepository.js';

describe('runsRepository', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Set up chained mock returns
		mockInsert.mockReturnValue({ values: mockValues });
		mockValues.mockReturnValue({ returning: mockReturning });
		mockUpdate.mockReturnValue({ set: mockSet });
		mockSet.mockReturnValue({ where: mockWhere });
		mockSelect.mockReturnValue({ from: mockFrom });
		mockFrom.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy });
		mockWhere.mockReturnValue({ orderBy: mockOrderBy });
		mockDelete.mockReturnValue({ where: mockWhere });
	});

	describe('createRun', () => {
		it('inserts a run and returns the id', async () => {
			mockReturning.mockResolvedValue([{ id: 'run-uuid-1' }]);

			const result = await createRun({
				projectId: 'proj-1',
				cardId: 'card-1',
				agentType: 'implementation',
				backend: 'llmist',
				triggerType: 'card-moved-to-todo',
				model: 'claude-3',
				maxIterations: 20,
			});

			expect(result).toBe('run-uuid-1');
			expect(mockInsert).toHaveBeenCalled();
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-1',
					cardId: 'card-1',
					agentType: 'implementation',
					backend: 'llmist',
					status: 'running',
				}),
			);
		});

		it('inserts with optional fields undefined', async () => {
			mockReturning.mockResolvedValue([{ id: 'run-uuid-2' }]);

			const result = await createRun({
				projectId: 'proj-1',
				agentType: 'splitting',
				backend: 'claude-code',
			});

			expect(result).toBe('run-uuid-2');
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-1',
					agentType: 'splitting',
					backend: 'claude-code',
					status: 'running',
					cardId: undefined,
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

	describe('getRunsByCardId', () => {
		it('returns runs ordered by startedAt desc', async () => {
			const mockRuns = [
				{ id: 'run-2', cardId: 'card-1' },
				{ id: 'run-1', cardId: 'card-1' },
			];
			mockOrderBy.mockResolvedValue(mockRuns);

			const result = await getRunsByCardId('card-1');
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
				llmistLog: 'llmist log text',
			});
		});

		it('handles undefined logs as null', async () => {
			mockValues.mockResolvedValue(undefined);

			await storeRunLogs('run-1');

			expect(mockValues).toHaveBeenCalledWith({
				runId: 'run-1',
				cascadeLog: null,
				llmistLog: null,
			});
		});
	});

	describe('getRunLogs', () => {
		it('returns logs when found', async () => {
			const mockLogs = { runId: 'run-1', cascadeLog: 'log text', llmistLog: null };
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
});

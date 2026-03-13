/**
 * Unit tests for jobId-related functions in src/db/repositories/runsRepository.ts
 *
 * Tests updateRunJobId and getRunJobId functions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the database client
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();

vi.mock('../../../src/db/client.js', () => ({
	getDb: () => ({
		update: mockUpdate,
		select: mockSelect,
	}),
}));

vi.mock('../../../src/db/schema/index.js', () => ({
	agentRuns: {
		id: 'id',
		jobId: 'job_id',
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
	},
	prWorkItems: {
		projectId: 'project_id',
		prNumber: 'pr_number',
		workItemUrl: 'work_item_url',
		workItemTitle: 'work_item_title',
		prTitle: 'pr_title',
	},
	agentRunLogs: { runId: 'run_id' },
	agentRunLlmCalls: {
		runId: 'run_id',
		callNumber: 'call_number',
		id: 'id',
	},
	debugAnalyses: { id: 'id' },
	projects: { id: 'id', orgId: 'org_id', name: 'name' },
	organizations: { id: 'id', name: 'name' },
}));

vi.mock('../../../src/db/repositories/joinHelpers.js', () => ({
	buildAgentRunWorkItemJoin: () => 'mock-join-condition',
}));

import { getRunJobId, updateRunJobId } from '../../../src/db/repositories/runsRepository.js';

describe('updateRunJobId', () => {
	beforeEach(() => {
		vi.resetAllMocks();

		// Set up chained mock returns for update
		mockUpdate.mockReturnValue({ set: mockSet });
		mockSet.mockReturnValue({ where: mockWhere });
		mockWhere.mockResolvedValue(undefined);
	});

	it('updates the job_id column for a given run', async () => {
		const runId = 'run-123';
		const jobId = 'job-456';

		await updateRunJobId(runId, jobId);

		expect(mockUpdate).toHaveBeenCalled();
		expect(mockSet).toHaveBeenCalledWith({ jobId });
		expect(mockWhere).toHaveBeenCalled();
	});

	it('handles multiple jobId updates independently', async () => {
		await updateRunJobId('run-1', 'job-1');
		await updateRunJobId('run-2', 'job-2');

		expect(mockUpdate).toHaveBeenCalledTimes(2);
		expect(mockSet).toHaveBeenNthCalledWith(1, { jobId: 'job-1' });
		expect(mockSet).toHaveBeenNthCalledWith(2, { jobId: 'job-2' });
	});
});

describe('getRunJobId', () => {
	beforeEach(() => {
		vi.resetAllMocks();

		// Set up chained mock returns for select
		mockSelect.mockReturnValue({ from: mockFrom });
		mockFrom.mockReturnValue({ where: mockWhere });
	});

	it('returns the job_id for a given run', async () => {
		const jobId = 'job-789';
		mockWhere.mockResolvedValue([{ jobId }]);

		const result = await getRunJobId('run-123');

		expect(result).toBe(jobId);
		expect(mockSelect).toHaveBeenCalled();
		expect(mockWhere).toHaveBeenCalled();
	});

	it('returns null when no job_id is found', async () => {
		mockWhere.mockResolvedValue([]);

		const result = await getRunJobId('run-nonexistent');

		expect(result).toBeNull();
	});

	it('returns null when the jobId field is null in the database', async () => {
		mockWhere.mockResolvedValue([{ jobId: null }]);

		const result = await getRunJobId('run-123');

		expect(result).toBeNull();
	});

	it('returns null when the row has no jobId property', async () => {
		mockWhere.mockResolvedValue([{}]);

		const result = await getRunJobId('run-123');

		expect(result).toBeNull();
	});

	it('handles multiple getRunJobId calls independently', async () => {
		mockWhere.mockResolvedValueOnce([{ jobId: 'job-1' }]);
		mockWhere.mockResolvedValueOnce([{ jobId: 'job-2' }]);

		const result1 = await getRunJobId('run-1');
		const result2 = await getRunJobId('run-2');

		expect(result1).toBe('job-1');
		expect(result2).toBe('job-2');
		expect(mockSelect).toHaveBeenCalledTimes(2);
	});
});

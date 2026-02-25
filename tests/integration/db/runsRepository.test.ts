import { beforeEach, describe, expect, it } from 'vitest';
import {
	completeRun,
	createRun,
	deleteDebugAnalysisByRunId,
	getDebugAnalysisByRunId,
	getLlmCallByNumber,
	getLlmCallsByRunId,
	getRunById,
	getRunLogs,
	getRunsByCardId,
	getRunsByProjectId,
	listLlmCallsMeta,
	listProjectsForOrg,
	listRuns,
	storeDebugAnalysis,
	storeLlmCall,
	storeLlmCallsBulk,
	storeRunLogs,
} from '../../../src/db/repositories/runsRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject } from '../helpers/seed.js';

describe('runsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// Run CRUD
	// =========================================================================

	describe('createRun', () => {
		it('creates a run and returns its ID', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});
			expect(id).toBeTruthy();
			expect(typeof id).toBe('string');
		});

		it('creates a run with optional fields', async () => {
			const id = await createRun({
				projectId: 'test-project',
				cardId: 'card-123',
				prNumber: 42,
				agentType: 'review',
				backend: 'llmist',
				triggerType: 'feature-implementation',
				model: 'claude-opus-4-5',
				maxIterations: 20,
			});
			const run = await getRunById(id);
			expect(run?.cardId).toBe('card-123');
			expect(run?.prNumber).toBe(42);
			expect(run?.agentType).toBe('review');
			expect(run?.backend).toBe('llmist');
			expect(run?.model).toBe('claude-opus-4-5');
			expect(run?.maxIterations).toBe(20);
			expect(run?.status).toBe('running');
		});
	});

	describe('completeRun', () => {
		it('marks a run as completed with metrics', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});

			await completeRun(id, {
				status: 'completed',
				durationMs: 5000,
				llmIterations: 10,
				gadgetCalls: 25,
				costUsd: 0.05,
				success: true,
				prUrl: 'https://github.com/owner/repo/pull/1',
				outputSummary: 'Implemented feature X',
			});

			const run = await getRunById(id);
			expect(run?.status).toBe('completed');
			expect(run?.durationMs).toBe(5000);
			expect(run?.llmIterations).toBe(10);
			expect(run?.gadgetCalls).toBe(25);
			expect(run?.success).toBe(true);
			expect(run?.prUrl).toBe('https://github.com/owner/repo/pull/1');
			expect(run?.completedAt).toBeDefined();
		});

		it('marks a run as failed with error', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});

			await completeRun(id, {
				status: 'failed',
				success: false,
				error: 'Connection timeout',
			});

			const run = await getRunById(id);
			expect(run?.status).toBe('failed');
			expect(run?.success).toBe(false);
			expect(run?.error).toBe('Connection timeout');
		});
	});

	describe('getRunById', () => {
		it('returns the run', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});
			const run = await getRunById(id);
			expect(run).toBeDefined();
			expect(run?.id).toBe(id);
		});

		it('returns null for non-existent ID', async () => {
			const run = await getRunById('00000000-0000-0000-0000-000000000000');
			expect(run).toBeNull();
		});
	});

	describe('getRunsByCardId', () => {
		it('returns all runs for a card', async () => {
			await createRun({
				projectId: 'test-project',
				cardId: 'card-A',
				agentType: 'implementation',
				backend: 'claude-code',
			});
			await createRun({
				projectId: 'test-project',
				cardId: 'card-A',
				agentType: 'review',
				backend: 'claude-code',
			});
			await createRun({
				projectId: 'test-project',
				cardId: 'card-B',
				agentType: 'implementation',
				backend: 'claude-code',
			});

			const runs = await getRunsByCardId('card-A');
			expect(runs).toHaveLength(2);
			expect(runs.every((r) => r.cardId === 'card-A')).toBe(true);
		});

		it('returns empty array for unknown card', async () => {
			const runs = await getRunsByCardId('nonexistent-card');
			expect(runs).toEqual([]);
		});
	});

	describe('getRunsByProjectId', () => {
		it('returns all runs for a project', async () => {
			await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});
			await createRun({ projectId: 'test-project', agentType: 'review', backend: 'claude-code' });

			const runs = await getRunsByProjectId('test-project');
			expect(runs).toHaveLength(2);
		});
	});

	// =========================================================================
	// Log Storage
	// =========================================================================

	describe('storeRunLogs / getRunLogs', () => {
		it('stores and retrieves logs for a run', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});

			await storeRunLogs(id, 'cascade log content', 'llmist log content');

			const logs = await getRunLogs(id);
			expect(logs?.cascadeLog).toBe('cascade log content');
			expect(logs?.llmistLog).toBe('llmist log content');
		});

		it('returns null for run with no logs', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});
			const logs = await getRunLogs(id);
			expect(logs).toBeNull();
		});
	});

	// =========================================================================
	// LLM Calls
	// =========================================================================

	describe('storeLlmCall / getLlmCallsByRunId', () => {
		it('stores and retrieves an LLM call', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});

			await storeLlmCall({
				runId: id,
				callNumber: 1,
				request: '{"messages":[]}',
				response: '{"content":"hello"}',
				inputTokens: 100,
				outputTokens: 50,
				costUsd: 0.001,
				durationMs: 500,
				model: 'claude-opus-4-5',
			});

			const calls = await getLlmCallsByRunId(id);
			expect(calls).toHaveLength(1);
			expect(calls[0].callNumber).toBe(1);
			expect(calls[0].inputTokens).toBe(100);
			expect(calls[0].outputTokens).toBe(50);
			expect(calls[0].model).toBe('claude-opus-4-5');
		});
	});

	describe('storeLlmCallsBulk', () => {
		it('stores multiple LLM calls at once', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});

			await storeLlmCallsBulk([
				{
					runId: id,
					callNumber: 1,
					model: 'model-1',
					inputTokens: 10,
					outputTokens: 5,
					costUsd: 0.001,
				},
				{
					runId: id,
					callNumber: 2,
					model: 'model-2',
					inputTokens: 20,
					outputTokens: 10,
					costUsd: 0.002,
				},
				{
					runId: id,
					callNumber: 3,
					model: 'model-3',
					inputTokens: 30,
					outputTokens: 15,
					costUsd: 0.003,
				},
			]);

			const calls = await getLlmCallsByRunId(id);
			expect(calls).toHaveLength(3);
			expect(calls.map((c) => c.callNumber)).toEqual([1, 2, 3]);
		});

		it('does nothing when given empty array', async () => {
			await expect(storeLlmCallsBulk([])).resolves.toBeUndefined();
		});
	});

	describe('getLlmCallByNumber', () => {
		it('returns a specific call by number', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});

			await storeLlmCallsBulk([
				{ runId: id, callNumber: 1, model: 'model-1' },
				{ runId: id, callNumber: 2, model: 'model-2' },
			]);

			const call = await getLlmCallByNumber(id, 2);
			expect(call).toBeDefined();
			expect(call?.callNumber).toBe(2);
			expect(call?.model).toBe('model-2');
		});

		it('returns null for non-existent call number', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});
			const call = await getLlmCallByNumber(id, 99);
			expect(call).toBeNull();
		});
	});

	describe('listLlmCallsMeta', () => {
		it('returns calls metadata without request/response bodies', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});

			await storeLlmCall({
				runId: id,
				callNumber: 1,
				request: 'big request body',
				response: 'big response body',
				inputTokens: 100,
				outputTokens: 50,
				model: 'claude-opus-4-5',
			});

			const meta = await listLlmCallsMeta(id);
			expect(meta).toHaveLength(1);
			expect(meta[0].inputTokens).toBe(100);
			// listLlmCallsMeta does not return request/response
			expect('request' in meta[0]).toBe(false);
			expect('response' in meta[0]).toBe(false);
		});
	});

	// =========================================================================
	// Debug Analysis
	// =========================================================================

	describe('storeDebugAnalysis / getDebugAnalysisByRunId / deleteDebugAnalysisByRunId', () => {
		it('stores and retrieves a debug analysis', async () => {
			const runId = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});

			const analysisId = await storeDebugAnalysis({
				analyzedRunId: runId,
				summary: 'Agent failed due to rate limit',
				issues: 'Rate limit exceeded after 5 retries',
				rootCause: 'Too many requests',
				severity: 'high',
				recommendations: 'Reduce request rate',
				timeline: 'T+0: started, T+10: rate limit hit',
			});

			expect(analysisId).toBeTruthy();

			const analysis = await getDebugAnalysisByRunId(runId);
			expect(analysis).toBeDefined();
			expect(analysis?.summary).toBe('Agent failed due to rate limit');
			expect(analysis?.severity).toBe('high');
		});

		it('returns null when no analysis exists', async () => {
			const runId = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});
			const analysis = await getDebugAnalysisByRunId(runId);
			expect(analysis).toBeNull();
		});

		it('deletes a debug analysis', async () => {
			const runId = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});

			await storeDebugAnalysis({
				analyzedRunId: runId,
				summary: 'Test summary',
				issues: 'Test issues',
			});

			await deleteDebugAnalysisByRunId(runId);

			const analysis = await getDebugAnalysisByRunId(runId);
			expect(analysis).toBeNull();
		});
	});

	// =========================================================================
	// Dashboard queries
	// =========================================================================

	describe('listRuns', () => {
		it('returns paginated runs with total count', async () => {
			await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});
			await createRun({ projectId: 'test-project', agentType: 'review', backend: 'claude-code' });
			await createRun({ projectId: 'test-project', agentType: 'planning', backend: 'claude-code' });

			const result = await listRuns({ orgId: 'test-org', limit: 10, offset: 0 });
			expect(result.data).toHaveLength(3);
			expect(result.total).toBe(3);
		});

		it('filters by projectId', async () => {
			await seedProject({ id: 'project-2', name: 'Project 2', repo: 'owner/repo2' });
			await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});
			await createRun({
				projectId: 'project-2',
				agentType: 'implementation',
				backend: 'claude-code',
			});

			const result = await listRuns({
				orgId: 'test-org',
				projectId: 'test-project',
				limit: 10,
				offset: 0,
			});
			expect(result.data).toHaveLength(1);
			expect(result.data[0].projectId).toBe('test-project');
		});

		it('filters by status', async () => {
			const id1 = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});
			const id2 = await createRun({
				projectId: 'test-project',
				agentType: 'review',
				backend: 'claude-code',
			});
			await completeRun(id1, { status: 'completed', success: true });
			await completeRun(id2, { status: 'failed', success: false });

			const completed = await listRuns({
				orgId: 'test-org',
				status: ['completed'],
				limit: 10,
				offset: 0,
			});
			expect(completed.data).toHaveLength(1);
			expect(completed.data[0].status).toBe('completed');
		});

		it('filters by agentType', async () => {
			await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});
			await createRun({ projectId: 'test-project', agentType: 'review', backend: 'claude-code' });

			const result = await listRuns({
				orgId: 'test-org',
				agentType: 'review',
				limit: 10,
				offset: 0,
			});
			expect(result.data).toHaveLength(1);
			expect(result.data[0].agentType).toBe('review');
		});

		it('respects limit and offset for pagination', async () => {
			for (let i = 0; i < 5; i++) {
				await createRun({
					projectId: 'test-project',
					agentType: 'implementation',
					backend: 'claude-code',
				});
			}

			const page1 = await listRuns({ orgId: 'test-org', limit: 2, offset: 0 });
			expect(page1.data).toHaveLength(2);
			expect(page1.total).toBe(5);

			const page2 = await listRuns({ orgId: 'test-org', limit: 2, offset: 2 });
			expect(page2.data).toHaveLength(2);
			expect(page2.total).toBe(5);
		});

		it('includes projectName in results', async () => {
			await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				backend: 'claude-code',
			});
			const result = await listRuns({ orgId: 'test-org', limit: 10, offset: 0 });
			expect(result.data[0].projectName).toBe('Test Project');
		});
	});

	describe('listProjectsForOrg', () => {
		it('returns all projects for an org', async () => {
			await seedProject({ id: 'project-2', name: 'Project 2', repo: 'owner/repo2' });
			const projects = await listProjectsForOrg('test-org');
			expect(projects).toHaveLength(2);
			expect(projects.map((p) => p.id).sort()).toEqual(['project-2', 'test-project']);
		});

		it('returns empty array for org with no projects', async () => {
			await seedOrg('empty-org', 'Empty Org');
			const projects = await listProjectsForOrg('empty-org');
			expect(projects).toEqual([]);
		});
	});
});

import { beforeEach, describe, expect, it } from 'vitest';
import {
	createWorkItem,
	linkPRToWorkItem,
} from '../../../src/db/repositories/prWorkItemsRepository.js';
import {
	completeRun,
	createRun,
	deleteDebugAnalysisByRunId,
	getDebugAnalysisByRunId,
	getLlmCallByNumber,
	getLlmCallsByRunId,
	getRunById,
	getRunLogs,
	getRunsByProjectId,
	getRunsByWorkItem,
	getRunsByWorkItemId,
	getRunsForPR,
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
				engine: 'claude-code',
			});
			expect(id).toBeTruthy();
			expect(typeof id).toBe('string');
		});

		it('creates a run with optional fields', async () => {
			const id = await createRun({
				projectId: 'test-project',
				workItemId: 'card-123',
				prNumber: 42,
				agentType: 'review',
				engine: 'llmist',
				triggerType: 'feature-implementation',
				model: 'claude-opus-4-5',
				maxIterations: 20,
			});
			const run = await getRunById(id);
			expect(run?.workItemId).toBe('card-123');
			expect(run?.prNumber).toBe(42);
			expect(run?.agentType).toBe('review');
			expect(run?.engine).toBe('llmist');
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
				engine: 'claude-code',
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
				engine: 'claude-code',
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
				engine: 'claude-code',
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

	describe('getRunsByWorkItemId', () => {
		it('returns all runs for a work item', async () => {
			await createRun({
				projectId: 'test-project',
				workItemId: 'card-A',
				agentType: 'implementation',
				engine: 'claude-code',
			});
			await createRun({
				projectId: 'test-project',
				workItemId: 'card-A',
				agentType: 'review',
				engine: 'claude-code',
			});
			await createRun({
				projectId: 'test-project',
				workItemId: 'card-B',
				agentType: 'implementation',
				engine: 'claude-code',
			});

			const runs = await getRunsByWorkItemId('card-A');
			expect(runs).toHaveLength(2);
			expect(runs.every((r) => r.workItemId === 'card-A')).toBe(true);
		});

		it('returns empty array for unknown work item', async () => {
			const runs = await getRunsByWorkItemId('nonexistent-card');
			expect(runs).toEqual([]);
		});
	});

	describe('getRunsByProjectId', () => {
		it('returns all runs for a project', async () => {
			await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				engine: 'claude-code',
			});
			await createRun({ projectId: 'test-project', agentType: 'review', engine: 'claude-code' });

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
				engine: 'claude-code',
			});

			await storeRunLogs(id, 'cascade log content', 'engine log content');

			const logs = await getRunLogs(id);
			expect(logs?.cascadeLog).toBe('cascade log content');
			expect(logs?.engineLog).toBe('engine log content');
		});

		it('returns null for run with no logs', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				engine: 'claude-code',
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
				engine: 'claude-code',
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
				engine: 'claude-code',
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
				engine: 'claude-code',
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
				engine: 'claude-code',
			});
			const call = await getLlmCallByNumber(id, 99);
			expect(call).toBeNull();
		});
	});

	describe('listLlmCallsMeta', () => {
		it('returns calls metadata with response but without request body', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				engine: 'claude-code',
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
			// listLlmCallsMeta excludes the large request body but includes
			// the response so the router can extract toolNames/textPreview
			expect('request' in meta[0]).toBe(false);
			expect(meta[0].response).toBe('big response body');
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
				engine: 'claude-code',
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
				engine: 'claude-code',
			});
			const analysis = await getDebugAnalysisByRunId(runId);
			expect(analysis).toBeNull();
		});

		it('deletes a debug analysis', async () => {
			const runId = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				engine: 'claude-code',
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
				engine: 'claude-code',
			});
			await createRun({ projectId: 'test-project', agentType: 'review', engine: 'claude-code' });
			await createRun({ projectId: 'test-project', agentType: 'planning', engine: 'claude-code' });

			const result = await listRuns({ orgId: 'test-org', limit: 10, offset: 0 });
			expect(result.data).toHaveLength(3);
			expect(result.total).toBe(3);
		});

		it('filters by projectId', async () => {
			await seedProject({ id: 'project-2', name: 'Project 2', repo: 'owner/repo2' });
			await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				engine: 'claude-code',
			});
			await createRun({
				projectId: 'project-2',
				agentType: 'implementation',
				engine: 'claude-code',
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
				engine: 'claude-code',
			});
			const id2 = await createRun({
				projectId: 'test-project',
				agentType: 'review',
				engine: 'claude-code',
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
				engine: 'claude-code',
			});
			await createRun({ projectId: 'test-project', agentType: 'review', engine: 'claude-code' });

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
					engine: 'claude-code',
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
				engine: 'claude-code',
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

	// =========================================================================
	// listRuns with pr_work_items enrichment
	// =========================================================================

	describe('listRuns enrichment (workItemUrl, workItemTitle, prTitle)', () => {
		it('includes null work item fields for runs without a linked PR work item row', async () => {
			await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				engine: 'claude-code',
			});

			const result = await listRuns({ orgId: 'test-org', limit: 10, offset: 0 });
			expect(result.data).toHaveLength(1);
			expect(result.data[0].workItemUrl).toBeNull();
			expect(result.data[0].workItemTitle).toBeNull();
			expect(result.data[0].prTitle).toBeNull();
		});

		it('enriches runs with work item info when a pr_work_items row exists', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 42, 'card-abc', {
				workItemUrl: 'https://trello.com/c/abc',
				workItemTitle: 'My Feature Card',
				prTitle: 'feat: my feature',
			});
			await createRun({
				projectId: 'test-project',
				prNumber: 42,
				agentType: 'implementation',
				engine: 'claude-code',
			});

			const result = await listRuns({ orgId: 'test-org', limit: 10, offset: 0 });
			expect(result.data).toHaveLength(1);
			expect(result.data[0].workItemUrl).toBe('https://trello.com/c/abc');
			expect(result.data[0].workItemTitle).toBe('My Feature Card');
			expect(result.data[0].prTitle).toBe('feat: my feature');
		});

		it('does not lose runs that have no pr_work_items row (LEFT JOIN correctness)', async () => {
			// Run without a linked PR
			await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				engine: 'claude-code',
			});
			// Run with a linked PR
			await linkPRToWorkItem('test-project', 'owner/repo', 7, 'card-7', {
				prTitle: 'PR Seven',
			});
			await createRun({
				projectId: 'test-project',
				prNumber: 7,
				agentType: 'review',
				engine: 'claude-code',
			});

			const result = await listRuns({ orgId: 'test-org', limit: 10, offset: 0 });
			expect(result.data).toHaveLength(2);
			const withPR = result.data.find((r) => r.prNumber === 7);
			const withoutPR = result.data.find((r) => r.prNumber === null);
			expect(withPR?.prTitle).toBe('PR Seven');
			expect(withoutPR?.prTitle).toBeNull();
		});
	});

	// =========================================================================
	// getRunById enrichment
	// =========================================================================

	describe('getRunById enrichment', () => {
		it('includes null work item fields for a run without a linked pr_work_items row', async () => {
			const id = await createRun({
				projectId: 'test-project',
				agentType: 'implementation',
				engine: 'claude-code',
			});
			const run = await getRunById(id);
			expect(run).not.toBeNull();
			expect(run?.workItemUrl).toBeNull();
			expect(run?.workItemTitle).toBeNull();
			expect(run?.prTitle).toBeNull();
		});

		it('enriches getRunById with work item info when a pr_work_items row exists', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 99, 'card-xyz', {
				workItemUrl: 'https://trello.com/c/xyz',
				workItemTitle: 'XYZ Card',
				prTitle: 'fix: xyz bug',
			});
			const id = await createRun({
				projectId: 'test-project',
				prNumber: 99,
				agentType: 'implementation',
				engine: 'claude-code',
			});
			const run = await getRunById(id);
			expect(run?.workItemUrl).toBe('https://trello.com/c/xyz');
			expect(run?.workItemTitle).toBe('XYZ Card');
			expect(run?.prTitle).toBe('fix: xyz bug');
		});
	});

	// =========================================================================
	// getRunsByWorkItem
	// =========================================================================

	describe('getRunsByWorkItem', () => {
		it('returns empty array when no runs exist for the work item', async () => {
			const runs = await getRunsByWorkItem('test-project', 'nonexistent-card');
			expect(runs).toEqual([]);
		});

		it('returns only runs matching the work item (workItemId)', async () => {
			await createRun({
				projectId: 'test-project',
				workItemId: 'card-target',
				agentType: 'implementation',
				engine: 'claude-code',
			});
			await createRun({
				projectId: 'test-project',
				workItemId: 'card-target',
				agentType: 'review',
				engine: 'claude-code',
			});
			await createRun({
				projectId: 'test-project',
				workItemId: 'card-other',
				agentType: 'implementation',
				engine: 'claude-code',
			});

			const runs = await getRunsByWorkItem('test-project', 'card-target');
			expect(runs).toHaveLength(2);
			expect(runs.every((r) => r.workItemId === 'card-target')).toBe(true);
		});

		it('enriches results with pr_work_items info when available', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 5, 'card-linked', {
				workItemUrl: 'https://trello.com/c/linked',
				workItemTitle: 'Linked Card',
				prTitle: 'feat: linked',
			});
			await createRun({
				projectId: 'test-project',
				workItemId: 'card-linked',
				prNumber: 5,
				agentType: 'implementation',
				engine: 'claude-code',
			});

			const runs = await getRunsByWorkItem('test-project', 'card-linked');
			expect(runs).toHaveLength(1);
			expect(runs[0].workItemUrl).toBe('https://trello.com/c/linked');
			expect(runs[0].workItemTitle).toBe('Linked Card');
			expect(runs[0].prTitle).toBe('feat: linked');
		});

		it('returns null for work item fields when no pr_work_items row matches', async () => {
			await createRun({
				projectId: 'test-project',
				workItemId: 'card-no-pr-link',
				agentType: 'implementation',
				engine: 'claude-code',
			});

			const runs = await getRunsByWorkItem('test-project', 'card-no-pr-link');
			expect(runs).toHaveLength(1);
			expect(runs[0].workItemUrl).toBeNull();
			expect(runs[0].workItemTitle).toBeNull();
			expect(runs[0].prTitle).toBeNull();
		});

		it('returns planning runs alongside PR-linked runs after work item promotion', async () => {
			// Step 1: Insert a work-item-only row (simulates PM-triggered card before PR exists)
			await createWorkItem('test-project', 'card-plan', {
				workItemUrl: 'https://trello.com/c/card-plan',
				workItemTitle: 'Planning Card',
			});

			// Step 2: Create a planning run with no prNumber (pre-PR)
			await createRun({
				projectId: 'test-project',
				workItemId: 'card-plan',
				agentType: 'planning',
				engine: 'claude-code',
			});

			// Step 3: Promote the work-item row by linking a PR to it
			await linkPRToWorkItem('test-project', 'owner/repo', 99, 'card-plan', {
				workItemUrl: 'https://trello.com/c/card-plan',
				workItemTitle: 'Planning Card',
				prTitle: 'feat: planning card implementation',
			});

			// Step 4: Create an implementation run with prNumber
			await createRun({
				projectId: 'test-project',
				workItemId: 'card-plan',
				prNumber: 99,
				agentType: 'implementation',
				engine: 'claude-code',
			});

			// Step 5: getRunsByWorkItem should return BOTH runs
			const runs = await getRunsByWorkItem('test-project', 'card-plan');
			expect(runs).toHaveLength(2);

			const planningRun = runs.find((r) => r.agentType === 'planning');
			const implRun = runs.find((r) => r.agentType === 'implementation');

			expect(planningRun).toBeDefined();
			expect(planningRun?.prNumber).toBeNull();
			expect(planningRun?.workItemId).toBe('card-plan');

			expect(implRun).toBeDefined();
			expect(implRun?.prNumber).toBe(99);
			expect(implRun?.workItemId).toBe('card-plan');
		});
	});

	// =========================================================================
	// getRunsForPR
	// =========================================================================

	describe('getRunsForPR', () => {
		it('returns empty array when no runs exist for the PR', async () => {
			const runs = await getRunsForPR('test-project', 999);
			expect(runs).toEqual([]);
		});

		it('returns only runs matching the PR number', async () => {
			await createRun({
				projectId: 'test-project',
				prNumber: 10,
				agentType: 'implementation',
				engine: 'claude-code',
			});
			await createRun({
				projectId: 'test-project',
				prNumber: 10,
				agentType: 'review',
				engine: 'claude-code',
			});
			await createRun({
				projectId: 'test-project',
				prNumber: 20,
				agentType: 'implementation',
				engine: 'claude-code',
			});

			const runs = await getRunsForPR('test-project', 10);
			expect(runs).toHaveLength(2);
			expect(runs.every((r) => r.prNumber === 10)).toBe(true);
		});

		it('enriches results with pr_work_items info', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 30, 'card-pr30', {
				workItemUrl: 'https://trello.com/c/pr30',
				workItemTitle: 'PR 30 Card',
				prTitle: 'feat: pr30',
			});
			await createRun({
				projectId: 'test-project',
				prNumber: 30,
				agentType: 'implementation',
				engine: 'claude-code',
			});

			const runs = await getRunsForPR('test-project', 30);
			expect(runs).toHaveLength(1);
			expect(runs[0].workItemUrl).toBe('https://trello.com/c/pr30');
			expect(runs[0].workItemTitle).toBe('PR 30 Card');
			expect(runs[0].prTitle).toBe('feat: pr30');
		});

		it('returns null for work item fields when no pr_work_items row exists', async () => {
			await createRun({
				projectId: 'test-project',
				prNumber: 40,
				agentType: 'review',
				engine: 'claude-code',
			});

			const runs = await getRunsForPR('test-project', 40);
			expect(runs).toHaveLength(1);
			expect(runs[0].workItemUrl).toBeNull();
			expect(runs[0].workItemTitle).toBeNull();
			expect(runs[0].prTitle).toBeNull();
		});

		it('does not return runs without a prNumber (pre-PR runs like planning)', async () => {
			// Create a planning run (no prNumber) for the same card
			await createRun({
				projectId: 'test-project',
				workItemId: 'card-gap-demo',
				agentType: 'planning',
				engine: 'claude-code',
			});
			// Create an implementation run with prNumber=99
			await createRun({
				projectId: 'test-project',
				workItemId: 'card-gap-demo',
				prNumber: 99,
				agentType: 'implementation',
				engine: 'claude-code',
			});

			// getRunsForPR only returns runs with prNumber=99 — it MISSES the planning run
			// This documents the expected (limited) behavior of getRunsForPR and shows why
			// the frontend must use getRunsByWorkItem for work items with a workItemId
			const runs = await getRunsForPR('test-project', 99);
			expect(runs).toHaveLength(1);
			expect(runs[0].agentType).toBe('implementation');
			expect(runs[0].prNumber).toBe(99);
		});
	});
});

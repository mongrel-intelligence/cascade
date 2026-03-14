import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSelect = vi.fn();

vi.mock('../../../../src/db/client.js', () => ({
	getDb: () => ({
		select: (...args: unknown[]) => mockSelect(...args),
	}),
}));

vi.mock('../../../../src/db/schema/index.js', () => ({
	agentRuns: {
		id: 'id',
		projectId: 'project_id',
		cardId: 'card_id',
		agentType: 'agent_type',
		status: 'status',
		startedAt: 'started_at',
		completedAt: 'completed_at',
		durationMs: 'duration_ms',
		costUsd: 'cost_usd',
		backend: 'backend',
		model: 'model',
		triggerType: 'trigger_type',
		llmIterations: 'llm_iterations',
		gadgetCalls: 'gadget_calls',
		prNumber: 'pr_number',
		prUrl: 'pr_url',
		success: 'success',
	},
	agentRunLlmCalls: {
		id: 'id',
		runId: 'run_id',
		callNumber: 'call_number',
		inputTokens: 'input_tokens',
		outputTokens: 'output_tokens',
		cachedTokens: 'cached_tokens',
		costUsd: 'cost_usd',
		durationMs: 'duration_ms',
		request: 'request',
		response: 'response',
	},
	projects: {
		id: 'id',
		name: 'name',
		orgId: 'org_id',
	},
	organizations: {
		id: 'id',
		name: 'name',
	},
	prWorkItems: {
		projectId: 'project_id',
		prNumber: 'pr_number',
		workItemUrl: 'work_item_url',
		workItemTitle: 'work_item_title',
		prTitle: 'pr_title',
	},
}));

import {
	getLlmCallByNumber,
	listLlmCallsMeta,
	listProjectsForOrg,
	listRuns,
} from '../../../../src/db/repositories/runsRepository.js';

// Helper: creates a chainable mock that resolves when awaited.
// Each method returns the chain (sync), and the chain itself is thenable.
function createChain(resolveValue: unknown = []) {
	const chain: Record<string, unknown> = {};
	const methods = ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'offset'];
	for (const method of methods) {
		chain[method] = vi.fn().mockReturnValue(chain);
	}
	// Make the chain thenable so it resolves when awaited
	// biome-ignore lint/suspicious/noThenProperty: intentional thenable mock for Drizzle chain
	chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolveValue).then(resolve);
	return chain as Record<string, ReturnType<typeof vi.fn>> & { then: unknown };
}

describe('runsRepository - dashboard queries', () => {
	describe('listRuns', () => {
		it('returns data and total count', async () => {
			const dataChain = createChain([{ id: 'run-1', agentType: 'impl', orgName: 'Org 1' }]);
			const countChain = createChain([{ total: 1 }]);

			mockSelect.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

			const result = await listRuns({
				orgId: 'org-1',
				limit: 50,
				offset: 0,
			});

			expect(result.data).toEqual([{ id: 'run-1', agentType: 'impl', orgName: 'Org 1' }]);
			expect(result.total).toBe(1);
		});

		it('passes limit and offset to the data query', async () => {
			const dataChain = createChain([]);
			const countChain = createChain([{ total: 0 }]);

			mockSelect.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

			await listRuns({
				orgId: 'org-1',
				limit: 10,
				offset: 20,
			});

			expect(dataChain.limit).toHaveBeenCalledWith(10);
			expect(dataChain.offset).toHaveBeenCalledWith(20);
		});
	});

	describe('getLlmCallByNumber', () => {
		it('returns LLM call row when found', async () => {
			const mockCall = { id: 'c1', runId: 'run-1', callNumber: 3, request: '{}', response: '{}' };
			const chain = createChain([mockCall]);
			mockSelect.mockReturnValue(chain);

			const result = await getLlmCallByNumber('run-1', 3);
			expect(result).toEqual(mockCall);
		});

		it('returns null when no matching call', async () => {
			const chain = createChain([]);
			mockSelect.mockReturnValue(chain);

			const result = await getLlmCallByNumber('run-1', 999);
			expect(result).toBeNull();
		});
	});

	describe('listLlmCallsMeta', () => {
		it('returns metadata fields ordered by callNumber', async () => {
			const mockMeta = [
				{ id: 'c1', callNumber: 1, inputTokens: 100 },
				{ id: 'c2', callNumber: 2, inputTokens: 200 },
			];
			const chain = createChain(mockMeta);
			mockSelect.mockReturnValue(chain);

			const result = await listLlmCallsMeta('run-1');
			expect(result).toEqual(mockMeta);
		});

		it('returns empty array when no calls for run', async () => {
			const chain = createChain([]);
			mockSelect.mockReturnValue(chain);

			const result = await listLlmCallsMeta('run-no-calls');
			expect(result).toEqual([]);
		});
	});

	describe('listProjectsForOrg', () => {
		it('returns project id and name for the given org', async () => {
			const mockProjects = [
				{ id: 'p1', name: 'Project 1' },
				{ id: 'p2', name: 'Project 2' },
			];
			const chain = createChain(mockProjects);
			mockSelect.mockReturnValue(chain);

			const result = await listProjectsForOrg('org-1');
			expect(result).toEqual(mockProjects);
		});

		it('returns empty array when org has no projects', async () => {
			const chain = createChain([]);
			mockSelect.mockReturnValue(chain);

			const result = await listProjectsForOrg('empty-org');
			expect(result).toEqual([]);
		});
	});
});

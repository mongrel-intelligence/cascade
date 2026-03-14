import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

vi.mock('../../../../src/db/schema/index.js', () => ({
	prWorkItems: {
		id: 'id',
		projectId: 'projectId',
		prNumber: 'prNumber',
		workItemId: 'workItemId',
		repoFullName: 'repoFullName',
		workItemUrl: 'workItemUrl',
		workItemTitle: 'workItemTitle',
		prUrl: 'prUrl',
		prTitle: 'prTitle',
		updatedAt: 'updatedAt',
	},
	agentRuns: {
		id: 'id',
		projectId: 'projectId',
		prNumber: 'prNumber',
		cardId: 'cardId',
		costUsd: 'costUsd',
	},
	projects: {
		id: 'id',
		orgId: 'orgId',
	},
}));

vi.mock('../../../../src/db/repositories/joinHelpers.js', () => ({
	buildAgentRunWorkItemJoin: vi.fn().mockReturnValue('mock-join-condition'),
}));

import { getDb } from '../../../../src/db/client.js';
import {
	createWorkItem,
	linkPRToWorkItem,
	listPRsForOrg,
	listPRsForProject,
	listPRsForWorkItem,
	listUnifiedWorkForProject,
	listWorkItems,
	lookupWorkItemForPR,
} from '../../../../src/db/repositories/prWorkItemsRepository.js';

// ---------------------------------------------------------------------------
// Minimal mock that supports both insert and update chains
// ---------------------------------------------------------------------------

function createMockChain(returningValue: unknown[] = []) {
	const chain: Record<string, ReturnType<typeof vi.fn>> = {};

	// Terminal: returning
	chain.returning = vi.fn().mockResolvedValue(returningValue);

	// select chain (simple: .from().where().limit())
	chain.limit = vi.fn().mockResolvedValue([]);
	chain.where = vi.fn().mockReturnValue({ limit: chain.limit, returning: chain.returning });
	chain.from = vi.fn().mockReturnValue({ where: chain.where });

	// update chain: set().where().returning()
	chain.updateWhere = vi.fn().mockReturnValue({ returning: chain.returning });
	chain.set = vi.fn().mockReturnValue({ where: chain.updateWhere });

	// insert chain
	chain.onConflictDoUpdate = vi.fn().mockReturnValue({ returning: chain.returning });
	chain.values = vi.fn().mockReturnValue({
		returning: chain.returning,
		onConflictDoUpdate: chain.onConflictDoUpdate,
	});

	return chain;
}

// ---------------------------------------------------------------------------
// Extended mock chain for aggregate/query functions with leftJoin + groupBy
// ---------------------------------------------------------------------------

/**
 * Build a promise-based result that also exposes `.orderBy()`.
 *
 * This models Drizzle's query builder where either `.groupBy()` or
 * `.groupBy().orderBy()` can be the terminal await point.
 *
 * We extend a real Promise so it is awaitable without relying on
 * the `then` property pattern (which triggers noThenProperty lint rule).
 */
function makeGroupByResult(
	rows: unknown[],
): Promise<unknown[]> & { orderBy: ReturnType<typeof vi.fn> } {
	const p = Promise.resolve(rows) as Promise<unknown[]> & { orderBy: ReturnType<typeof vi.fn> };
	p.orderBy = vi.fn().mockResolvedValue(rows);
	return p;
}

function createQueryMockChain(resolvedRows: unknown[] = []) {
	const chain: Record<string, ReturnType<typeof vi.fn>> = {};

	// groupBy returns a thenable that resolves to resolvedRows,
	// and also has .orderBy() for queries that sort after grouping.
	chain.groupBy = vi.fn().mockReturnValue(makeGroupByResult(resolvedRows));
	chain.where = vi.fn().mockReturnValue({ groupBy: chain.groupBy });
	chain.leftJoin = vi.fn().mockReturnValue({ where: chain.where, groupBy: chain.groupBy });
	chain.from = vi.fn().mockReturnValue({ leftJoin: chain.leftJoin, where: chain.where });

	// Simple select chain without joins (used for sub-queries like project lookups)
	chain.simpleWhere = vi.fn().mockResolvedValue([]);
	chain.simpleFrom = vi.fn().mockReturnValue({ where: chain.simpleWhere });

	return chain;
}

/** Helper to make a queryChain that returns specific rows. */
function makeQueryChainWithRows(rows: unknown[]): ReturnType<typeof createQueryMockChain> {
	const qc = createQueryMockChain();
	qc.groupBy.mockReturnValue(makeGroupByResult(rows));
	return qc;
}

describe('prWorkItemsRepository', () => {
	let chain: ReturnType<typeof createMockChain>;
	let mockDb: {
		select: ReturnType<typeof vi.fn>;
		insert: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
		delete: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		// linkPRToWorkItem's two-step logic: first update (returns []), then insert.
		// Default: update returns [] (no existing work-item row), insert proceeds.
		chain = createMockChain([]);

		mockDb = {
			select: vi.fn().mockReturnValue({ from: chain.from }),
			insert: vi.fn().mockReturnValue({ values: chain.values }),
			update: vi.fn().mockReturnValue({ set: chain.set }),
			delete: vi.fn(),
		};
		vi.mocked(getDb).mockReturnValue(mockDb as never);
	});

	// ==========================================================================
	// createWorkItem
	// ==========================================================================

	describe('createWorkItem', () => {
		it('inserts a work-item-only row when no existing row found', async () => {
			// Default: SELECT returns [] (no existing row)
			await createWorkItem('proj-1', 'wi-abc', {
				workItemUrl: 'https://trello.com/c/abc',
				workItemTitle: 'My Card',
			});

			expect(mockDb.select).toHaveBeenCalledTimes(1);
			expect(mockDb.insert).toHaveBeenCalledTimes(1);
			expect(chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-1',
					workItemId: 'wi-abc',
					workItemUrl: 'https://trello.com/c/abc',
					workItemTitle: 'My Card',
				}),
			);
		});

		it('updates existing work-item-only row when found', async () => {
			// Simulate: SELECT finds an existing work-item-only row
			chain.limit.mockResolvedValueOnce([{ id: 'existing-id' }]);

			await createWorkItem('proj-1', 'wi-abc', {
				workItemUrl: 'https://trello.com/c/abc',
				workItemTitle: 'My Card',
			});

			expect(mockDb.select).toHaveBeenCalledTimes(1);
			expect(mockDb.update).toHaveBeenCalledTimes(1);
			expect(mockDb.insert).not.toHaveBeenCalled();
			expect(chain.set).toHaveBeenCalledWith(
				expect.objectContaining({
					workItemUrl: 'https://trello.com/c/abc',
					workItemTitle: 'My Card',
					updatedAt: expect.any(Date),
				}),
			);
		});

		it('skips insert when row already exists with prNumber (promoted)', async () => {
			// Simulate: SELECT finds an existing promoted row (has prNumber)
			chain.limit.mockResolvedValueOnce([{ id: 'existing-id' }]);

			await createWorkItem('proj-1', 'wi-abc');

			expect(mockDb.select).toHaveBeenCalledTimes(1);
			expect(mockDb.update).toHaveBeenCalledTimes(1);
			expect(mockDb.insert).not.toHaveBeenCalled();
		});

		it('sets updatedAt on insert', async () => {
			await createWorkItem('proj-1', 'wi-abc');

			const valuesArg = chain.values.mock.calls[0][0];
			expect(valuesArg.updatedAt).toBeInstanceOf(Date);
		});

		it('omits optional display fields when not provided', async () => {
			await createWorkItem('proj-1', 'wi-abc');

			const valuesArg = chain.values.mock.calls[0][0];
			expect(valuesArg.workItemUrl).toBeUndefined();
			expect(valuesArg.workItemTitle).toBeUndefined();
		});

		it('does not set prNumber or repoFullName', async () => {
			await createWorkItem('proj-1', 'wi-abc');

			const valuesArg = chain.values.mock.calls[0][0];
			expect(valuesArg.prNumber).toBeUndefined();
			expect(valuesArg.repoFullName).toBeUndefined();
		});
	});

	// ==========================================================================
	// linkPRToWorkItem
	// ==========================================================================

	describe('linkPRToWorkItem', () => {
		it('attempts to update existing work-item-only row first', async () => {
			// Default: update returns [] (no pre-existing row), falls through to insert
			await linkPRToWorkItem('proj-1', 'owner/repo', 42, 'wi-abc');

			expect(mockDb.update).toHaveBeenCalledTimes(1);
			expect(chain.set).toHaveBeenCalledWith(
				expect.objectContaining({
					repoFullName: 'owner/repo',
					prNumber: 42,
				}),
			);
		});

		it('inserts a PR-to-work-item link when no pre-existing row', async () => {
			// update returns [] → falls through to insert
			await linkPRToWorkItem('proj-1', 'owner/repo', 42, 'wi-abc');

			expect(mockDb.insert).toHaveBeenCalledTimes(1);
			expect(chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-1',
					repoFullName: 'owner/repo',
					prNumber: 42,
					workItemId: 'wi-abc',
				}),
			);
		});

		it('skips insert when pre-existing work-item row is updated', async () => {
			// Simulate: update finds and updates a pre-existing work-item-only row
			chain.returning.mockResolvedValueOnce([{ id: 'existing-id' }]);

			await linkPRToWorkItem('proj-1', 'owner/repo', 42, 'wi-abc');

			// update should have been called, but insert should NOT be called
			expect(mockDb.update).toHaveBeenCalledTimes(1);
			expect(mockDb.insert).not.toHaveBeenCalled();
		});

		it('calls onConflictDoUpdate for upsert behavior on insert path', async () => {
			await linkPRToWorkItem('proj-1', 'owner/repo', 42, 'wi-abc');

			expect(chain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
			expect(chain.onConflictDoUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					target: expect.arrayContaining([expect.anything(), expect.anything()]),
					set: expect.objectContaining({ workItemId: 'wi-abc', repoFullName: 'owner/repo' }),
				}),
			);
		});

		it('persists optional display fields when provided', async () => {
			await linkPRToWorkItem('proj-1', 'owner/repo', 42, 'wi-abc', {
				workItemUrl: 'https://trello.com/c/abc',
				workItemTitle: 'My Card',
				prUrl: 'https://github.com/owner/repo/pull/42',
				prTitle: 'feat: my feature',
			});

			expect(chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					workItemUrl: 'https://trello.com/c/abc',
					workItemTitle: 'My Card',
					prUrl: 'https://github.com/owner/repo/pull/42',
					prTitle: 'feat: my feature',
				}),
			);
		});

		it('accepts null workItemId for orphan PRs', async () => {
			// With null workItemId, update step is skipped, goes straight to insert
			await linkPRToWorkItem('proj-1', 'owner/repo', 42, null);

			expect(mockDb.update).not.toHaveBeenCalled();
			expect(chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-1',
					workItemId: null,
				}),
			);
		});

		it('sets updatedAt on insert and conflict update', async () => {
			await linkPRToWorkItem('proj-1', 'owner/repo', 42, 'wi-abc');

			const valuesArg = chain.values.mock.calls[0][0];
			expect(valuesArg.updatedAt).toBeInstanceOf(Date);

			const conflictArg = chain.onConflictDoUpdate.mock.calls[0][0];
			expect(conflictArg.set.updatedAt).toBeInstanceOf(Date);
		});

		it('omits optional display fields when not provided', async () => {
			await linkPRToWorkItem('proj-1', 'owner/repo', 42, 'wi-abc');

			const valuesArg = chain.values.mock.calls[0][0];
			expect(valuesArg.workItemUrl).toBeUndefined();
			expect(valuesArg.workItemTitle).toBeUndefined();
			expect(valuesArg.prUrl).toBeUndefined();
			expect(valuesArg.prTitle).toBeUndefined();
		});
	});

	// ==========================================================================
	// lookupWorkItemForPR
	// ==========================================================================

	describe('lookupWorkItemForPR', () => {
		it('returns workItemId when a matching row is found', async () => {
			chain.limit.mockResolvedValueOnce([{ workItemId: 'wi-found' }]);

			const result = await lookupWorkItemForPR('proj-1', 42);

			expect(result).toBe('wi-found');
			expect(mockDb.select).toHaveBeenCalledTimes(1);
		});

		it('returns null when no matching row is found', async () => {
			chain.limit.mockResolvedValueOnce([]);

			const result = await lookupWorkItemForPR('proj-1', 999);

			expect(result).toBeNull();
		});

		it('returns null when workItemId is null (orphan PR)', async () => {
			chain.limit.mockResolvedValueOnce([{ workItemId: null }]);

			const result = await lookupWorkItemForPR('proj-1', 42);

			expect(result).toBeNull();
		});

		it('queries with correct project and PR number', async () => {
			chain.limit.mockResolvedValueOnce([]);

			await lookupWorkItemForPR('proj-2', 77);

			expect(mockDb.select).toHaveBeenCalledTimes(1);
			expect(chain.from).toHaveBeenCalledTimes(1);
			expect(chain.where).toHaveBeenCalledTimes(1);
			expect(chain.limit).toHaveBeenCalledWith(1);
		});
	});

	// ==========================================================================
	// listWorkItems
	// ==========================================================================

	describe('listWorkItems', () => {
		let queryChain: ReturnType<typeof createQueryMockChain>;

		beforeEach(() => {
			queryChain = createQueryMockChain();
		});

		it('returns empty array when no projects found for org (no projectId)', async () => {
			// First select call: projects sub-query returns []
			mockDb.select = vi.fn().mockReturnValueOnce({ from: queryChain.simpleFrom });

			queryChain.simpleWhere.mockResolvedValueOnce([]);

			const result = await listWorkItems('org-1');

			expect(result).toEqual([]);
		});

		it('returns work items filtered by projectId when provided', async () => {
			// No project sub-query when projectId provided — only main query
			const mockRows = [
				{
					workItemId: 'wi-1',
					workItemUrl: 'https://trello.com/c/1',
					workItemTitle: 'Card 1',
					prCount: 2,
					runCount: 3,
				},
			];
			const qc = makeQueryChainWithRows(mockRows);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listWorkItems('org-1', 'proj-1');

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				workItemId: 'wi-1',
				workItemUrl: 'https://trello.com/c/1',
				workItemTitle: 'Card 1',
				prCount: 2,
				runCount: 3,
			});
		});

		it('maps rows correctly including null fields', async () => {
			const mockRows = [
				{
					workItemId: 'wi-2',
					workItemUrl: null,
					workItemTitle: null,
					prCount: 0,
					runCount: 0,
				},
			];
			const qc = makeQueryChainWithRows(mockRows);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listWorkItems('org-1', 'proj-2');

			expect(result[0].workItemUrl).toBeNull();
			expect(result[0].workItemTitle).toBeNull();
		});

		it('queries without projectId by fetching project ids for org', async () => {
			// First select call: projects sub-query; second: main prWorkItems query
			const mockRows = [
				{
					workItemId: 'wi-org',
					workItemUrl: null,
					workItemTitle: 'Org Card',
					prCount: 1,
					runCount: 1,
				},
			];
			const projectQc = createQueryMockChain();
			const mainQc = makeQueryChainWithRows(mockRows);

			mockDb.select = vi
				.fn()
				.mockReturnValueOnce({ from: projectQc.simpleFrom }) // project sub-query
				.mockReturnValueOnce({ from: mainQc.from }); // main query

			projectQc.simpleWhere.mockResolvedValueOnce([{ id: 'proj-a' }, { id: 'proj-b' }]);

			const result = await listWorkItems('org-1');

			expect(result).toHaveLength(1);
			expect(result[0].workItemId).toBe('wi-org');
		});
	});

	// ==========================================================================
	// listPRsForProject
	// ==========================================================================

	describe('listPRsForProject', () => {
		it('returns all PRs for a project', async () => {
			const mockRows = [
				{
					prNumber: 42,
					repoFullName: 'owner/repo',
					prUrl: 'https://github.com/owner/repo/pull/42',
					prTitle: 'feat: my feature',
					workItemId: 'wi-1',
					workItemUrl: 'https://trello.com/c/1',
					workItemTitle: 'My Card',
					runCount: 2,
				},
			];
			const qc = makeQueryChainWithRows(mockRows);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listPRsForProject('proj-1');

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual(mockRows[0]);
		});

		it('returns empty array when no PRs found', async () => {
			const qc = makeQueryChainWithRows([]);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listPRsForProject('proj-empty');

			expect(result).toEqual([]);
		});

		it('calls leftJoin with agentRuns using buildAgentRunWorkItemJoin', async () => {
			const qc = makeQueryChainWithRows([]);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			await listPRsForProject('proj-1');

			expect(qc.leftJoin).toHaveBeenCalledWith(expect.anything(), 'mock-join-condition');
		});

		it('returns multiple PRs sorted by prNumber', async () => {
			const mockRows = [
				{
					prNumber: 10,
					repoFullName: 'owner/repo',
					prUrl: null,
					prTitle: null,
					workItemId: null,
					workItemUrl: null,
					workItemTitle: null,
					runCount: 0,
				},
				{
					prNumber: 20,
					repoFullName: 'owner/repo',
					prUrl: null,
					prTitle: null,
					workItemId: 'wi-2',
					workItemUrl: null,
					workItemTitle: null,
					runCount: 1,
				},
			];
			const qc = makeQueryChainWithRows(mockRows);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listPRsForProject('proj-1');

			expect(result).toHaveLength(2);
		});
	});

	// ==========================================================================
	// listPRsForOrg
	// ==========================================================================

	describe('listPRsForOrg', () => {
		it('returns empty array when org has no projects', async () => {
			const projectQc = createQueryMockChain();
			mockDb.select = vi.fn().mockReturnValueOnce({ from: projectQc.simpleFrom });
			projectQc.simpleWhere.mockResolvedValueOnce([]);

			const result = await listPRsForOrg('org-empty');

			expect(result).toEqual([]);
		});

		it('returns PRs for all projects in the org', async () => {
			const projectQc = createQueryMockChain();
			const mockRows = [
				{
					prNumber: 1,
					repoFullName: 'owner/repo',
					prUrl: 'https://github.com/owner/repo/pull/1',
					prTitle: 'PR title',
					workItemId: 'wi-1',
					workItemUrl: null,
					workItemTitle: null,
					runCount: 1,
				},
			];
			const mainQc = makeQueryChainWithRows(mockRows);

			mockDb.select = vi
				.fn()
				.mockReturnValueOnce({ from: projectQc.simpleFrom })
				.mockReturnValueOnce({ from: mainQc.from });

			projectQc.simpleWhere.mockResolvedValueOnce([{ id: 'proj-a' }, { id: 'proj-b' }]);

			const result = await listPRsForOrg('org-1');

			expect(result).toHaveLength(1);
			expect(result[0].prNumber).toBe(1);
		});

		it('queries project ids by orgId before fetching PRs', async () => {
			const projectQc = createQueryMockChain();
			const mainQc = makeQueryChainWithRows([]);

			mockDb.select = vi
				.fn()
				.mockReturnValueOnce({ from: projectQc.simpleFrom })
				.mockReturnValueOnce({ from: mainQc.from });

			projectQc.simpleWhere.mockResolvedValueOnce([{ id: 'proj-x' }]);

			await listPRsForOrg('org-1');

			// First select was for projects, second for PRs
			expect(mockDb.select).toHaveBeenCalledTimes(2);
		});

		it('calls leftJoin with agentRuns using buildAgentRunWorkItemJoin', async () => {
			const projectQc = createQueryMockChain();
			const mainQc = makeQueryChainWithRows([]);

			mockDb.select = vi
				.fn()
				.mockReturnValueOnce({ from: projectQc.simpleFrom })
				.mockReturnValueOnce({ from: mainQc.from });

			projectQc.simpleWhere.mockResolvedValueOnce([{ id: 'proj-a' }]);

			await listPRsForOrg('org-1');

			expect(mainQc.leftJoin).toHaveBeenCalledWith(expect.anything(), 'mock-join-condition');
		});
	});

	// ==========================================================================
	// listPRsForWorkItem
	// ==========================================================================

	describe('listPRsForWorkItem', () => {
		it('returns all PRs linked to a specific work item', async () => {
			const mockRows = [
				{
					prNumber: 55,
					repoFullName: 'owner/repo',
					prUrl: 'https://github.com/owner/repo/pull/55',
					prTitle: 'Linked PR',
					workItemId: 'wi-abc',
					workItemUrl: 'https://trello.com/c/abc',
					workItemTitle: 'ABC Card',
					runCount: 3,
				},
			];
			const qc = makeQueryChainWithRows(mockRows);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listPRsForWorkItem('proj-1', 'wi-abc');

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual(mockRows[0]);
		});

		it('returns empty array when work item has no linked PRs', async () => {
			const qc = makeQueryChainWithRows([]);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listPRsForWorkItem('proj-1', 'wi-none');

			expect(result).toEqual([]);
		});

		it('calls leftJoin with agentRuns for enriched run count data', async () => {
			const qc = makeQueryChainWithRows([]);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			await listPRsForWorkItem('proj-1', 'wi-abc');

			expect(qc.leftJoin).toHaveBeenCalledWith(expect.anything(), 'mock-join-condition');
		});

		it('filters by both projectId and workItemId', async () => {
			const qc = makeQueryChainWithRows([]);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			await listPRsForWorkItem('proj-specific', 'wi-specific');

			// where() should be called once with the combined filter
			expect(qc.where).toHaveBeenCalledTimes(1);
		});

		it('returns runCount of 0 when no agent runs linked', async () => {
			const mockRows = [
				{
					prNumber: 10,
					repoFullName: 'owner/repo',
					prUrl: null,
					prTitle: null,
					workItemId: 'wi-abc',
					workItemUrl: null,
					workItemTitle: null,
					runCount: 0,
				},
			];
			const qc = makeQueryChainWithRows(mockRows);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listPRsForWorkItem('proj-1', 'wi-abc');

			expect(result[0].runCount).toBe(0);
		});
	});

	// ==========================================================================
	// listUnifiedWorkForProject
	// ==========================================================================

	describe('listUnifiedWorkForProject', () => {
		it('classifies rows with no prNumber as work-item type', async () => {
			const mockRows = [
				{
					id: 'row-1',
					prNumber: null,
					repoFullName: null,
					prUrl: null,
					prTitle: null,
					workItemId: 'wi-1',
					workItemUrl: 'https://trello.com/c/1',
					workItemTitle: 'My Work Item',
					updatedAt: new Date('2024-01-01'),
					runCount: 1,
					totalCostUsd: '0.05',
				},
			];
			const qc = makeQueryChainWithRows(mockRows);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listUnifiedWorkForProject('proj-1');

			expect(result).toHaveLength(1);
			expect(result[0].type).toBe('work-item');
		});

		it('classifies rows with prNumber and workItemId as linked type', async () => {
			const mockRows = [
				{
					id: 'row-2',
					prNumber: 42,
					repoFullName: 'owner/repo',
					prUrl: 'https://github.com/owner/repo/pull/42',
					prTitle: 'feat: something',
					workItemId: 'wi-2',
					workItemUrl: 'https://trello.com/c/2',
					workItemTitle: 'Linked Card',
					updatedAt: new Date('2024-01-02'),
					runCount: 2,
					totalCostUsd: '1.23',
				},
			];
			const qc = makeQueryChainWithRows(mockRows);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listUnifiedWorkForProject('proj-1');

			expect(result[0].type).toBe('linked');
		});

		it('classifies rows with prNumber but no workItemId as pr type', async () => {
			const mockRows = [
				{
					id: 'row-3',
					prNumber: 99,
					repoFullName: 'owner/repo',
					prUrl: 'https://github.com/owner/repo/pull/99',
					prTitle: 'fix: orphan PR',
					workItemId: null,
					workItemUrl: null,
					workItemTitle: null,
					updatedAt: new Date('2024-01-03'),
					runCount: 0,
					totalCostUsd: null,
				},
			];
			const qc = makeQueryChainWithRows(mockRows);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listUnifiedWorkForProject('proj-1');

			expect(result[0].type).toBe('pr');
		});

		it('returns all three types in a mixed result set', async () => {
			const now = new Date();
			const mockRows = [
				{
					id: 'wi-row',
					prNumber: null,
					repoFullName: null,
					prUrl: null,
					prTitle: null,
					workItemId: 'wi-only',
					workItemUrl: null,
					workItemTitle: 'Work Item',
					updatedAt: now,
					runCount: 0,
					totalCostUsd: null,
				},
				{
					id: 'linked-row',
					prNumber: 10,
					repoFullName: 'owner/repo',
					prUrl: null,
					prTitle: null,
					workItemId: 'wi-linked',
					workItemUrl: null,
					workItemTitle: 'Linked',
					updatedAt: now,
					runCount: 1,
					totalCostUsd: '0.10',
				},
				{
					id: 'pr-row',
					prNumber: 20,
					repoFullName: 'owner/repo',
					prUrl: null,
					prTitle: null,
					workItemId: null,
					workItemUrl: null,
					workItemTitle: null,
					updatedAt: now,
					runCount: 0,
					totalCostUsd: null,
				},
			];
			const qc = makeQueryChainWithRows(mockRows);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listUnifiedWorkForProject('proj-1');

			expect(result).toHaveLength(3);
			expect(result.find((r) => r.id === 'wi-row')?.type).toBe('work-item');
			expect(result.find((r) => r.id === 'linked-row')?.type).toBe('linked');
			expect(result.find((r) => r.id === 'pr-row')?.type).toBe('pr');
		});

		it('returns empty array when project has no work entries', async () => {
			const qc = makeQueryChainWithRows([]);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listUnifiedWorkForProject('proj-empty');

			expect(result).toEqual([]);
		});

		it('maps totalCostUsd to null when DB returns null', async () => {
			const mockRows = [
				{
					id: 'row-no-cost',
					prNumber: null,
					repoFullName: null,
					prUrl: null,
					prTitle: null,
					workItemId: 'wi-1',
					workItemUrl: null,
					workItemTitle: null,
					updatedAt: new Date(),
					runCount: 0,
					totalCostUsd: null,
				},
			];
			const qc = makeQueryChainWithRows(mockRows);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listUnifiedWorkForProject('proj-1');

			expect(result[0].totalCostUsd).toBeNull();
		});

		it('preserves totalCostUsd string when present', async () => {
			const mockRows = [
				{
					id: 'row-with-cost',
					prNumber: 5,
					repoFullName: 'owner/repo',
					prUrl: null,
					prTitle: null,
					workItemId: 'wi-1',
					workItemUrl: null,
					workItemTitle: null,
					updatedAt: new Date(),
					runCount: 2,
					totalCostUsd: '2.50',
				},
			];
			const qc = makeQueryChainWithRows(mockRows);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			const result = await listUnifiedWorkForProject('proj-1');

			expect(result[0].totalCostUsd).toBe('2.50');
		});

		it('calls leftJoin with agentRuns using buildAgentRunWorkItemJoin', async () => {
			const qc = makeQueryChainWithRows([]);
			mockDb.select = vi.fn().mockReturnValue({ from: qc.from });

			await listUnifiedWorkForProject('proj-1');

			expect(qc.leftJoin).toHaveBeenCalledWith(expect.anything(), 'mock-join-condition');
		});
	});
});

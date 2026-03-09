import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/db/client.js', () => ({
	getDb: vi.fn(),
}));

vi.mock('../../../../src/db/schema/index.js', () => ({
	prWorkItems: {
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
}));

import { getDb } from '../../../../src/db/client.js';
import {
	createWorkItem,
	linkPRToWorkItem,
	lookupWorkItemForPR,
} from '../../../../src/db/repositories/prWorkItemsRepository.js';

// ---------------------------------------------------------------------------
// Minimal mock that supports both insert and update chains
// ---------------------------------------------------------------------------

function createMockChain(returningValue: unknown[] = []) {
	const chain: Record<string, ReturnType<typeof vi.fn>> = {};

	// Terminal: returning
	chain.returning = vi.fn().mockResolvedValue(returningValue);

	// select chain
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
		it('inserts a work-item-only row with correct values', async () => {
			await createWorkItem('proj-1', 'wi-abc', {
				workItemUrl: 'https://trello.com/c/abc',
				workItemTitle: 'My Card',
			});

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

		it('calls onConflictDoUpdate for idempotent upsert', async () => {
			await createWorkItem('proj-1', 'wi-abc');

			expect(chain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
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
});

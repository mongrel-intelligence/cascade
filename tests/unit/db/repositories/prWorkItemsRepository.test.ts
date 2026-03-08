import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '../../../helpers/mockDb.js';

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
	linkPRToWorkItem,
	lookupWorkItemForPR,
} from '../../../../src/db/repositories/prWorkItemsRepository.js';

describe('prWorkItemsRepository', () => {
	let mockDb: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		mockDb = createMockDb({ withLimit: true, withUpsert: true });
		vi.mocked(getDb).mockReturnValue(mockDb.db as never);
	});

	// ==========================================================================
	// linkPRToWorkItem
	// ==========================================================================

	describe('linkPRToWorkItem', () => {
		it('inserts a PR-to-work-item link with correct values', async () => {
			await linkPRToWorkItem('proj-1', 'owner/repo', 42, 'wi-abc');

			expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-1',
					repoFullName: 'owner/repo',
					prNumber: 42,
					workItemId: 'wi-abc',
				}),
			);
		});

		it('calls onConflictDoUpdate for upsert behavior', async () => {
			await linkPRToWorkItem('proj-1', 'owner/repo', 42, 'wi-abc');

			expect(mockDb.chain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.onConflictDoUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					target: expect.arrayContaining([expect.anything(), expect.anything()]),
					set: expect.objectContaining({ workItemId: 'wi-abc', repoFullName: 'owner/repo' }),
				}),
			);
		});

		it('updates workItemId and repoFullName on conflict', async () => {
			await linkPRToWorkItem('proj-1', 'new-owner/repo', 99, 'wi-new');

			const conflictArg = mockDb.chain.onConflictDoUpdate.mock.calls[0][0];
			expect(conflictArg.set).toMatchObject({
				workItemId: 'wi-new',
				repoFullName: 'new-owner/repo',
			});
		});

		it('persists optional display fields when provided', async () => {
			await linkPRToWorkItem('proj-1', 'owner/repo', 42, 'wi-abc', {
				workItemUrl: 'https://trello.com/c/abc',
				workItemTitle: 'My Card',
				prUrl: 'https://github.com/owner/repo/pull/42',
				prTitle: 'feat: my feature',
			});

			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					workItemUrl: 'https://trello.com/c/abc',
					workItemTitle: 'My Card',
					prUrl: 'https://github.com/owner/repo/pull/42',
					prTitle: 'feat: my feature',
				}),
			);

			const conflictArg = mockDb.chain.onConflictDoUpdate.mock.calls[0][0];
			expect(conflictArg.set).toMatchObject({
				workItemUrl: 'https://trello.com/c/abc',
				workItemTitle: 'My Card',
				prUrl: 'https://github.com/owner/repo/pull/42',
				prTitle: 'feat: my feature',
			});
		});

		it('accepts null workItemId for orphan PRs', async () => {
			await linkPRToWorkItem('proj-1', 'owner/repo', 42, null);

			expect(mockDb.chain.values).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'proj-1',
					workItemId: null,
				}),
			);
		});

		it('sets updatedAt on insert and conflict update', async () => {
			await linkPRToWorkItem('proj-1', 'owner/repo', 42, 'wi-abc');

			const valuesArg = mockDb.chain.values.mock.calls[0][0];
			expect(valuesArg.updatedAt).toBeInstanceOf(Date);

			const conflictArg = mockDb.chain.onConflictDoUpdate.mock.calls[0][0];
			expect(conflictArg.set.updatedAt).toBeInstanceOf(Date);
		});

		it('omits optional display fields when not provided', async () => {
			await linkPRToWorkItem('proj-1', 'owner/repo', 42, 'wi-abc');

			const valuesArg = mockDb.chain.values.mock.calls[0][0];
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
			mockDb.chain.limit.mockResolvedValueOnce([{ workItemId: 'wi-found' }]);

			const result = await lookupWorkItemForPR('proj-1', 42);

			expect(result).toBe('wi-found');
			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
		});

		it('returns null when no matching row is found', async () => {
			mockDb.chain.limit.mockResolvedValueOnce([]);

			const result = await lookupWorkItemForPR('proj-1', 999);

			expect(result).toBeNull();
		});

		it('returns null when workItemId is null (orphan PR)', async () => {
			mockDb.chain.limit.mockResolvedValueOnce([{ workItemId: null }]);

			const result = await lookupWorkItemForPR('proj-1', 42);

			expect(result).toBeNull();
		});

		it('queries with correct project and PR number', async () => {
			mockDb.chain.limit.mockResolvedValueOnce([]);

			await lookupWorkItemForPR('proj-2', 77);

			expect(mockDb.db.select).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.from).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.where).toHaveBeenCalledTimes(1);
			expect(mockDb.chain.limit).toHaveBeenCalledWith(1);
		});
	});
});

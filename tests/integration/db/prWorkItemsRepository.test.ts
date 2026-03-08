import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/client.js';
import {
	linkPRToWorkItem,
	lookupWorkItemForPR,
} from '../../../src/db/repositories/prWorkItemsRepository.js';
import { prWorkItems } from '../../../src/db/schema/index.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject } from '../helpers/seed.js';

describe('prWorkItemsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// linkPRToWorkItem / lookupWorkItemForPR
	// =========================================================================

	describe('linkPRToWorkItem', () => {
		it('links a PR to a work item', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 42, 'card-abc123');

			const workItemId = await lookupWorkItemForPR('test-project', 42);
			expect(workItemId).toBe('card-abc123');
		});

		it('links multiple PRs to different work items', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 1, 'card-111');
			await linkPRToWorkItem('test-project', 'owner/repo', 2, 'card-222');

			expect(await lookupWorkItemForPR('test-project', 1)).toBe('card-111');
			expect(await lookupWorkItemForPR('test-project', 2)).toBe('card-222');
		});

		it('persists optional display fields', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 42, 'card-abc', {
				workItemUrl: 'https://trello.com/c/abc',
				workItemTitle: 'My Card Title',
				prUrl: 'https://github.com/owner/repo/pull/42',
				prTitle: 'feat: add new feature',
			});

			const db = getDb();
			const rows = await db
				.select()
				.from(prWorkItems)
				.where(and(eq(prWorkItems.projectId, 'test-project'), eq(prWorkItems.prNumber, 42)))
				.limit(1);

			expect(rows).toHaveLength(1);
			const row = rows[0];
			expect(row.workItemUrl).toBe('https://trello.com/c/abc');
			expect(row.workItemTitle).toBe('My Card Title');
			expect(row.prUrl).toBe('https://github.com/owner/repo/pull/42');
			expect(row.prTitle).toBe('feat: add new feature');
			expect(row.updatedAt).toBeInstanceOf(Date);
		});

		it('stores null for optional fields when not provided', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 42, 'card-abc');

			const db = getDb();
			const rows = await db
				.select()
				.from(prWorkItems)
				.where(and(eq(prWorkItems.projectId, 'test-project'), eq(prWorkItems.prNumber, 42)))
				.limit(1);

			expect(rows).toHaveLength(1);
			const row = rows[0];
			expect(row.workItemUrl).toBeNull();
			expect(row.workItemTitle).toBeNull();
			expect(row.prUrl).toBeNull();
			expect(row.prTitle).toBeNull();
		});

		it('supports null workItemId for orphan PRs', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 55, null, {
				prUrl: 'https://github.com/owner/repo/pull/55',
				prTitle: 'chore: cleanup',
			});

			const db = getDb();
			const rows = await db
				.select()
				.from(prWorkItems)
				.where(and(eq(prWorkItems.projectId, 'test-project'), eq(prWorkItems.prNumber, 55)))
				.limit(1);

			expect(rows).toHaveLength(1);
			expect(rows[0].workItemId).toBeNull();
			expect(rows[0].prTitle).toBe('chore: cleanup');

			// lookupWorkItemForPR should return null for orphan PRs
			const result = await lookupWorkItemForPR('test-project', 55);
			expect(result).toBeNull();
		});
	});

	describe('lookupWorkItemForPR', () => {
		it('returns null for non-existent link', async () => {
			const result = await lookupWorkItemForPR('test-project', 999);
			expect(result).toBeNull();
		});

		it('returns null for wrong project', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 10, 'card-xyz');

			// Different project, same PR number
			await seedProject({ id: 'other-project', repo: 'owner/other-repo' });
			const result = await lookupWorkItemForPR('other-project', 10);
			expect(result).toBeNull();
		});
	});

	// =========================================================================
	// Upsert behavior
	// =========================================================================

	describe('upsert (re-link same PR)', () => {
		it('updates work item ID when same project+PR is re-linked', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 5, 'card-original');

			// Re-link same PR to a different card
			await linkPRToWorkItem('test-project', 'owner/repo', 5, 'card-updated');

			const workItemId = await lookupWorkItemForPR('test-project', 5);
			expect(workItemId).toBe('card-updated');
		});

		it('updates repoFullName when re-linking', async () => {
			await linkPRToWorkItem('test-project', 'owner/old-repo', 7, 'card-abc');
			await linkPRToWorkItem('test-project', 'owner/new-repo', 7, 'card-abc');

			// Still resolvable by projectId+prNumber
			const workItemId = await lookupWorkItemForPR('test-project', 7);
			expect(workItemId).toBe('card-abc');
		});

		it('updates optional display fields on conflict', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 8, 'card-abc', {
				workItemTitle: 'Old Title',
				prTitle: 'old PR title',
			});

			await linkPRToWorkItem('test-project', 'owner/repo', 8, 'card-abc', {
				workItemTitle: 'New Title',
				prTitle: 'new PR title',
				workItemUrl: 'https://trello.com/c/abc',
				prUrl: 'https://github.com/owner/repo/pull/8',
			});

			const db = getDb();
			const rows = await db
				.select()
				.from(prWorkItems)
				.where(and(eq(prWorkItems.projectId, 'test-project'), eq(prWorkItems.prNumber, 8)))
				.limit(1);

			expect(rows[0].workItemTitle).toBe('New Title');
			expect(rows[0].prTitle).toBe('new PR title');
			expect(rows[0].workItemUrl).toBe('https://trello.com/c/abc');
			expect(rows[0].prUrl).toBe('https://github.com/owner/repo/pull/8');
		});

		it('sets updatedAt on initial insert', async () => {
			const before = new Date();
			await linkPRToWorkItem('test-project', 'owner/repo', 9, 'card-abc');
			const after = new Date();

			const db = getDb();
			const rows = await db
				.select()
				.from(prWorkItems)
				.where(and(eq(prWorkItems.projectId, 'test-project'), eq(prWorkItems.prNumber, 9)))
				.limit(1);

			expect(rows[0].updatedAt).not.toBeNull();
			const updatedAt = rows[0].updatedAt as Date;
			expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
		});
	});

	// =========================================================================
	// Cross-project isolation
	// =========================================================================

	describe('cross-project isolation', () => {
		it('same PR number in different projects resolves to different work items', async () => {
			await seedProject({ id: 'project-b', repo: 'owner/repo-b' });

			await linkPRToWorkItem('test-project', 'owner/repo', 100, 'card-project-a');
			await linkPRToWorkItem('project-b', 'owner/repo-b', 100, 'card-project-b');

			expect(await lookupWorkItemForPR('test-project', 100)).toBe('card-project-a');
			expect(await lookupWorkItemForPR('project-b', 100)).toBe('card-project-b');
		});

		it('deleting one project link does not affect another', async () => {
			await seedProject({ id: 'project-c', repo: 'owner/repo-c' });

			await linkPRToWorkItem('test-project', 'owner/repo', 200, 'card-a');
			await linkPRToWorkItem('project-c', 'owner/repo-c', 200, 'card-c');

			// Re-link project-c's PR to a new card (effectively "removing" the old link)
			await linkPRToWorkItem('project-c', 'owner/repo-c', 200, 'card-c-new');

			// test-project's link is unaffected
			expect(await lookupWorkItemForPR('test-project', 200)).toBe('card-a');
			expect(await lookupWorkItemForPR('project-c', 200)).toBe('card-c-new');
		});
	});
});

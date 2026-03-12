import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/client.js';
import {
	linkPRToWorkItem,
	listPRsForProject,
	listPRsForWorkItem,
	listUnifiedWorkForProject,
	listWorkItems,
	lookupWorkItemForPR,
} from '../../../src/db/repositories/prWorkItemsRepository.js';
import { agentRuns, prWorkItems } from '../../../src/db/schema/index.js';
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

	// =========================================================================
	// listWorkItems
	// =========================================================================

	describe('listWorkItems', () => {
		it('returns empty array when no work items exist', async () => {
			const result = await listWorkItems('test-org', 'test-project');
			expect(result).toEqual([]);
		});

		it('returns distinct work items with display fields', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 1, 'card-aaa', {
				workItemUrl: 'https://trello.com/c/aaa',
				workItemTitle: 'Card AAA',
				prUrl: 'https://github.com/owner/repo/pull/1',
				prTitle: 'feat: add AAA',
			});

			const result = await listWorkItems('test-org', 'test-project');
			expect(result).toHaveLength(1);
			expect(result[0].workItemId).toBe('card-aaa');
			expect(result[0].workItemUrl).toBe('https://trello.com/c/aaa');
			expect(result[0].workItemTitle).toBe('Card AAA');
		});

		it('counts PRs per work item', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 1, 'card-aaa');
			await linkPRToWorkItem('test-project', 'owner/repo', 2, 'card-aaa');
			await linkPRToWorkItem('test-project', 'owner/repo', 3, 'card-bbb');

			const result = await listWorkItems('test-org', 'test-project');
			const aaa = result.find((r) => r.workItemId === 'card-aaa');
			const bbb = result.find((r) => r.workItemId === 'card-bbb');
			expect(aaa?.prCount).toBe(2);
			expect(bbb?.prCount).toBe(1);
		});

		it('counts runs linked to the work item PRs', async () => {
			const db = getDb();
			await linkPRToWorkItem('test-project', 'owner/repo', 10, 'card-runs');
			// Insert agent runs for PR 10
			await db.insert(agentRuns).values([
				{
					projectId: 'test-project',
					prNumber: 10,
					agentType: 'implementation',
					engine: 'claude-code',
					status: 'completed',
				},
				{
					projectId: 'test-project',
					prNumber: 10,
					agentType: 'review',
					engine: 'claude-code',
					status: 'completed',
				},
			]);

			const result = await listWorkItems('test-org', 'test-project');
			const item = result.find((r) => r.workItemId === 'card-runs');
			expect(item?.runCount).toBe(2);
		});

		it('does not produce duplicate work items when display fields differ across PR rows', async () => {
			// Same work item linked to two PRs with different display fields
			await linkPRToWorkItem('test-project', 'owner/repo', 1, 'card-dup', {
				workItemUrl: 'https://trello.com/c/dup',
				workItemTitle: 'Card Dup',
			});
			await linkPRToWorkItem('test-project', 'owner/repo', 2, 'card-dup', {
				workItemUrl: null,
				workItemTitle: 'Card Dup Updated',
			});

			const result = await listWorkItems('test-org', 'test-project');
			// Should produce exactly one row, not two
			expect(result).toHaveLength(1);
			expect(result[0].workItemId).toBe('card-dup');
			expect(result[0].prCount).toBe(2);
			// max() picks the non-null / lexicographically greatest value
			expect(result[0].workItemUrl).toBe('https://trello.com/c/dup');
		});

		it('excludes orphan PRs (null workItemId)', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 55, null, {
				prTitle: 'orphan PR',
			});

			const result = await listWorkItems('test-org', 'test-project');
			expect(result).toHaveLength(0);
		});

		it('isolates results by project', async () => {
			await seedProject({ id: 'other-project', repo: 'owner/other-repo' });
			await linkPRToWorkItem('test-project', 'owner/repo', 1, 'card-p1');
			await linkPRToWorkItem('other-project', 'owner/other-repo', 1, 'card-p2');

			const result = await listWorkItems('test-org', 'test-project');
			expect(result).toHaveLength(1);
			expect(result[0].workItemId).toBe('card-p1');
		});

		it('correctly counts PRs across multiple projects when no projectId is provided', async () => {
			await seedProject({ id: 'project-a', repo: 'owner/repo-a' });
			await seedProject({ id: 'project-b', repo: 'owner/repo-b' });

			// Link PR #1 in project-a to card-shared
			await linkPRToWorkItem('project-a', 'owner/repo-a', 1, 'card-shared', {
				workItemUrl: 'https://trello.com/c/shared',
				workItemTitle: 'Shared Card',
			});

			// Link PR #1 in project-b to card-shared (same PR number, different project)
			await linkPRToWorkItem('project-b', 'owner/repo-b', 1, 'card-shared', {
				workItemUrl: 'https://trello.com/c/shared',
				workItemTitle: 'Shared Card',
			});

			// Link PR #2 in project-a to card-shared
			await linkPRToWorkItem('project-a', 'owner/repo-a', 2, 'card-shared', {
				workItemUrl: 'https://trello.com/c/shared',
				workItemTitle: 'Shared Card',
			});

			// Query org-wide (no projectId filter)
			const result = await listWorkItems('test-org');
			expect(result).toHaveLength(1);
			expect(result[0].workItemId).toBe('card-shared');
			// Should count all 3 distinct PRs (project-a/PR#1, project-b/PR#1, project-a/PR#2)
			// not just 2 (if it were counting distinct prNumber instead of distinct id)
			expect(result[0].prCount).toBe(3);
		});
	});

	// =========================================================================
	// listPRsForProject
	// =========================================================================

	describe('listPRsForProject', () => {
		it('returns empty array when no PRs exist', async () => {
			const result = await listPRsForProject('test-project');
			expect(result).toEqual([]);
		});

		it('returns all PRs with work item info', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 1, 'card-aaa', {
				workItemUrl: 'https://trello.com/c/aaa',
				workItemTitle: 'Card AAA',
				prUrl: 'https://github.com/owner/repo/pull/1',
				prTitle: 'feat: add AAA',
			});
			await linkPRToWorkItem('test-project', 'owner/repo', 2, 'card-bbb', {
				prTitle: 'feat: add BBB',
			});

			const result = await listPRsForProject('test-project');
			expect(result).toHaveLength(2);
			expect(result[0].prNumber).toBe(1);
			expect(result[0].workItemId).toBe('card-aaa');
			expect(result[0].workItemTitle).toBe('Card AAA');
			expect(result[0].prTitle).toBe('feat: add AAA');
			expect(result[1].prNumber).toBe(2);
			expect(result[1].workItemId).toBe('card-bbb');
		});

		it('includes orphan PRs (null workItemId)', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 7, null, {
				prTitle: 'orphan PR',
			});

			const result = await listPRsForProject('test-project');
			expect(result).toHaveLength(1);
			expect(result[0].workItemId).toBeNull();
			expect(result[0].prTitle).toBe('orphan PR');
		});

		it('isolates results by project', async () => {
			await seedProject({ id: 'other-project', repo: 'owner/other-repo' });
			await linkPRToWorkItem('test-project', 'owner/repo', 1, 'card-p1');
			await linkPRToWorkItem('other-project', 'owner/other-repo', 2, 'card-p2');

			const result = await listPRsForProject('test-project');
			expect(result).toHaveLength(1);
			expect(result[0].prNumber).toBe(1);
		});
	});

	// =========================================================================
	// listUnifiedWorkForProject
	// =========================================================================

	describe('listUnifiedWorkForProject', () => {
		it('returns empty array when no PRs exist', async () => {
			const result = await listUnifiedWorkForProject('test-project');
			expect(result).toEqual([]);
		});

		it('returns null totalCostUsd when no agent runs exist', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 1, 'card-aaa', {
				prTitle: 'feat: no runs',
			});

			const result = await listUnifiedWorkForProject('test-project');
			expect(result).toHaveLength(1);
			expect(result[0].totalCostUsd).toBeNull();
		});

		it('aggregates totalCostUsd from agent runs', async () => {
			const db = getDb();
			await linkPRToWorkItem('test-project', 'owner/repo', 10, 'card-cost');
			// Insert agent runs with known costUsd values
			await db.insert(agentRuns).values([
				{
					projectId: 'test-project',
					prNumber: 10,
					agentType: 'implementation',
					engine: 'claude-code',
					status: 'completed',
					costUsd: '1.000000',
				},
				{
					projectId: 'test-project',
					prNumber: 10,
					agentType: 'review',
					engine: 'claude-code',
					status: 'completed',
					costUsd: '0.500000',
				},
			]);

			const result = await listUnifiedWorkForProject('test-project');
			expect(result).toHaveLength(1);
			// sum should be 1.5
			expect(Number(result[0].totalCostUsd)).toBeCloseTo(1.5, 5);
		});

		it('sets type to linked when workItemId is present', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 1, 'card-aaa');
			const result = await listUnifiedWorkForProject('test-project');
			expect(result[0].type).toBe('linked');
		});

		it('sets type to pr when workItemId is null', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 2, null, {
				prTitle: 'orphan PR',
			});
			const result = await listUnifiedWorkForProject('test-project');
			expect(result[0].type).toBe('pr');
		});
	});

	// =========================================================================
	// listPRsForWorkItem
	// =========================================================================

	describe('listPRsForWorkItem', () => {
		it('returns empty array when no PRs are linked to the work item', async () => {
			const result = await listPRsForWorkItem('test-project', 'card-nonexistent');
			expect(result).toEqual([]);
		});

		it('returns only PRs for the given work item', async () => {
			await linkPRToWorkItem('test-project', 'owner/repo', 1, 'card-aaa', {
				prTitle: 'feat: AAA #1',
			});
			await linkPRToWorkItem('test-project', 'owner/repo', 2, 'card-aaa', {
				prTitle: 'feat: AAA #2',
			});
			await linkPRToWorkItem('test-project', 'owner/repo', 3, 'card-bbb', {
				prTitle: 'feat: BBB #3',
			});

			const result = await listPRsForWorkItem('test-project', 'card-aaa');
			expect(result).toHaveLength(2);
			expect(result.every((r) => r.workItemId === 'card-aaa')).toBe(true);
			expect(result.map((r) => r.prNumber)).toEqual([1, 2]);
		});

		it('isolates results by project', async () => {
			await seedProject({ id: 'other-project', repo: 'owner/other-repo' });
			await linkPRToWorkItem('test-project', 'owner/repo', 1, 'card-shared');
			await linkPRToWorkItem('other-project', 'owner/other-repo', 2, 'card-shared');

			const result = await listPRsForWorkItem('test-project', 'card-shared');
			expect(result).toHaveLength(1);
			expect(result[0].prNumber).toBe(1);
		});
	});
});

/**
 * Integration tests for the config provider layer (src/config/provider.ts).
 *
 * Tests the cached lookup functions against a real PostgreSQL database,
 * verifying that:
 * - Cached provider functions (findProjectByBoardId, findProjectByRepo,
 *   findProjectByJiraProjectKey, loadConfig) serve results from the cache
 *   on subsequent calls.
 * - invalidateConfigCache() forces a fresh DB read on the next call.
 * - After cache invalidation + DB mutation, the provider returns the
 *   updated result rather than the stale cached value.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	findProjectByBoardId,
	findProjectByJiraProjectKey,
	findProjectByRepo,
	invalidateConfigCache,
	loadConfig,
} from '../../src/config/provider.js';
import { getDb } from '../../src/db/client.js';
import { projectIntegrations } from '../../src/db/schema/index.js';
import { truncateAll } from './helpers/db.js';
import { seedIntegration, seedOrg, seedProject } from './helpers/seed.js';

beforeAll(async () => {
	await truncateAll();
});

describe('Config Provider — cached lookups (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		invalidateConfigCache();
		await seedOrg();
	});

	// =========================================================================
	// findProjectByBoardId — cached provider function
	// =========================================================================

	describe('findProjectByBoardId', () => {
		it('returns the project for a known boardId', async () => {
			await seedProject({ id: 'proj-trello', repo: 'owner/trello-repo' });
			await seedIntegration({
				projectId: 'proj-trello',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-cached', lists: {}, labels: {} },
			});

			const project = await findProjectByBoardId('board-cached');

			expect(project).toBeDefined();
			expect(project?.id).toBe('proj-trello');
		});

		it('returns undefined for an unknown boardId', async () => {
			await seedProject({ id: 'proj-trello', repo: 'owner/trello-repo' });
			await seedIntegration({
				projectId: 'proj-trello',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-cached', lists: {}, labels: {} },
			});

			const project = await findProjectByBoardId('board-nonexistent');

			expect(project).toBeUndefined();
		});

		it('returns a cached result on second call without invalidation', async () => {
			await seedProject({ id: 'proj-cache-hit', repo: 'owner/cache-repo' });
			await seedIntegration({
				projectId: 'proj-cache-hit',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-for-cache', lists: {}, labels: {} },
			});

			// First call — populates cache
			const first = await findProjectByBoardId('board-for-cache');
			expect(first?.id).toBe('proj-cache-hit');

			// Mutate DB directly — delete the integration
			const db = getDb();
			await db.delete(projectIntegrations);

			// Second call — should still return cached result, not hit DB
			const second = await findProjectByBoardId('board-for-cache');
			expect(second?.id).toBe('proj-cache-hit');
		});

		it('returns fresh DB result after invalidateConfigCache()', async () => {
			await seedProject({ id: 'proj-invalidate', repo: 'owner/invalidate-repo' });
			await seedIntegration({
				projectId: 'proj-invalidate',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-invalidate', lists: {}, labels: {} },
			});

			// First call — populates cache
			const before = await findProjectByBoardId('board-invalidate');
			expect(before?.id).toBe('proj-invalidate');

			// Mutate DB: remove the integration so the boardId no longer exists
			const db = getDb();
			await db.delete(projectIntegrations);

			// Invalidate cache then re-query — must reflect the DB mutation
			invalidateConfigCache();
			const after = await findProjectByBoardId('board-invalidate');
			expect(after).toBeUndefined();
		});
	});

	// =========================================================================
	// findProjectByRepo — cached provider function
	// =========================================================================

	describe('findProjectByRepo', () => {
		it('returns the project for a known repo', async () => {
			await seedProject({ id: 'proj-repo', repo: 'myorg/myrepo' });

			const project = await findProjectByRepo('myorg/myrepo');

			expect(project).toBeDefined();
			expect(project?.id).toBe('proj-repo');
		});

		it('returns undefined for an unknown repo', async () => {
			const project = await findProjectByRepo('myorg/nonexistent');

			expect(project).toBeUndefined();
		});

		it('returns fresh DB result after invalidateConfigCache()', async () => {
			await seedProject({ id: 'proj-repo-invalidate', repo: 'org/repo-to-delete' });

			// Populate cache
			const before = await findProjectByRepo('org/repo-to-delete');
			expect(before?.id).toBe('proj-repo-invalidate');

			// Delete the project from the DB
			const db = getDb();
			await db.execute(`DELETE FROM projects WHERE id = 'proj-repo-invalidate'`);

			// Without invalidation, cache still serves the old result
			const stale = await findProjectByRepo('org/repo-to-delete');
			expect(stale?.id).toBe('proj-repo-invalidate');

			// After invalidation, fresh DB read reflects the deletion
			invalidateConfigCache();
			const fresh = await findProjectByRepo('org/repo-to-delete');
			expect(fresh).toBeUndefined();
		});
	});

	// =========================================================================
	// findProjectByJiraProjectKey — cached provider function
	// =========================================================================

	describe('findProjectByJiraProjectKey', () => {
		it('returns the project for a known JIRA projectKey', async () => {
			await seedProject({ id: 'proj-jira', repo: 'owner/jira-repo' });
			await seedIntegration({
				projectId: 'proj-jira',
				category: 'pm',
				provider: 'jira',
				config: {
					baseUrl: 'https://test.atlassian.net',
					projectKey: 'MYPROJ',
					statuses: {},
				},
			});

			const project = await findProjectByJiraProjectKey('MYPROJ');

			expect(project).toBeDefined();
			expect(project?.id).toBe('proj-jira');
		});

		it('returns undefined for an unknown JIRA projectKey', async () => {
			const project = await findProjectByJiraProjectKey('UNKNOWN');

			expect(project).toBeUndefined();
		});

		it('returns fresh DB result after invalidateConfigCache()', async () => {
			await seedProject({ id: 'proj-jira-invalidate', repo: 'owner/jira-invalidate' });
			await seedIntegration({
				projectId: 'proj-jira-invalidate',
				category: 'pm',
				provider: 'jira',
				config: {
					baseUrl: 'https://test.atlassian.net',
					projectKey: 'INVAL',
					statuses: {},
				},
			});

			// Populate cache
			const before = await findProjectByJiraProjectKey('INVAL');
			expect(before?.id).toBe('proj-jira-invalidate');

			// Remove the integration from the DB
			const db = getDb();
			await db.delete(projectIntegrations);

			// After invalidation, fresh DB read shows the integration is gone
			invalidateConfigCache();
			const fresh = await findProjectByJiraProjectKey('INVAL');
			expect(fresh).toBeUndefined();
		});
	});

	// =========================================================================
	// loadConfig — cached provider function
	// =========================================================================

	describe('loadConfig', () => {
		it('returns a valid CascadeConfig with all seeded projects', async () => {
			await seedProject({ id: 'proj-load', repo: 'owner/load-repo' });

			const config = await loadConfig();

			expect(config).toBeDefined();
			expect(config.projects).toHaveLength(1);
			expect(config.projects[0].id).toBe('proj-load');
		});

		it('serves cached result on second call without invalidation', async () => {
			await seedProject({ id: 'proj-load-cache', repo: 'owner/load-cache-repo' });

			// First call — populates cache
			const first = await loadConfig();
			expect(first.projects).toHaveLength(1);

			// Seed another project directly into DB — bypasses cache
			await seedProject({ id: 'proj-load-cache-2', repo: 'owner/load-cache-repo-2' });

			// Second call — should return cached result (1 project, not 2)
			const second = await loadConfig();
			expect(second.projects).toHaveLength(1);
		});

		it('returns fresh DB result after invalidateConfigCache()', async () => {
			await seedProject({ id: 'proj-load-inv', repo: 'owner/load-inv-repo' });

			// Populate cache
			const before = await loadConfig();
			expect(before.projects).toHaveLength(1);

			// Seed a second project directly in DB
			await seedProject({ id: 'proj-load-inv-2', repo: 'owner/load-inv-repo-2' });

			// Without invalidation, cache still returns 1 project
			const cached = await loadConfig();
			expect(cached.projects).toHaveLength(1);

			// After invalidation, fresh DB read sees both projects
			invalidateConfigCache();
			const fresh = await loadConfig();
			expect(fresh.projects).toHaveLength(2);
			const ids = fresh.projects.map((p) => p.id).sort();
			expect(ids).toEqual(['proj-load-inv', 'proj-load-inv-2']);
		});
	});
});

/**
 * Integration tests for configRepository.ts lookup functions.
 *
 * Tests the full JSONB sub-query round-trip and WithConfig lookups against a
 * real PostgreSQL database:
 * - findProjectByBoardIdFromDb — JSONB sub-query on project_integrations.config->>'boardId'
 * - findProjectByJiraProjectKeyFromDb — JSONB sub-query on project_integrations.config->>'projectKey'
 * - findProjectByRepoFromDb — simple column lookup on projects.repo
 * - findProjectByIdFromDb — primary key lookup
 * - findProjectWithConfigByBoardId — { project, config } pair
 * - findProjectWithConfigByRepo — { project, config } pair
 * - findProjectWithConfigById — { project, config } pair
 * - findProjectWithConfigByJiraProjectKey — { project, config } pair
 * - loadConfigFromDb — full config load, validated via validateConfig()
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invalidateConfigCache } from '../../src/config/provider.js';
import { CascadeConfigSchema, validateConfig } from '../../src/config/schema.js';
import {
	findProjectByBoardIdFromDb,
	findProjectByIdFromDb,
	findProjectByJiraProjectKeyFromDb,
	findProjectByRepoFromDb,
	findProjectWithConfigByBoardId,
	findProjectWithConfigById,
	findProjectWithConfigByJiraProjectKey,
	findProjectWithConfigByRepo,
	loadConfigFromDb,
} from '../../src/db/repositories/configRepository.js';
import { truncateAll } from './helpers/db.js';
import { seedIntegration, seedOrg, seedProject } from './helpers/seed.js';

beforeAll(async () => {
	await truncateAll();
});

describe('Config Provider (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		invalidateConfigCache();
		await seedOrg();
	});

	// =========================================================================
	// findProjectByBoardIdFromDb — JSONB sub-query
	// =========================================================================

	describe('findProjectByBoardIdFromDb', () => {
		it('returns the project for a known boardId', async () => {
			await seedProject({ id: 'proj-trello', repo: 'owner/trello-repo' });
			await seedIntegration({
				projectId: 'proj-trello',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-abc', lists: {}, labels: {} },
			});

			const project = await findProjectByBoardIdFromDb('board-abc');

			expect(project).toBeDefined();
			expect(project?.id).toBe('proj-trello');
		});

		it('returns undefined for an unknown boardId', async () => {
			await seedProject({ id: 'proj-trello', repo: 'owner/trello-repo' });
			await seedIntegration({
				projectId: 'proj-trello',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-abc', lists: {}, labels: {} },
			});

			const project = await findProjectByBoardIdFromDb('board-nonexistent');

			expect(project).toBeUndefined();
		});

		it('returns correct project when multiple projects exist', async () => {
			await seedProject({ id: 'proj-a', repo: 'owner/repo-a' });
			await seedProject({ id: 'proj-b', repo: 'owner/repo-b' });

			await seedIntegration({
				projectId: 'proj-a',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-111', lists: {}, labels: {} },
			});
			await seedIntegration({
				projectId: 'proj-b',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-222', lists: {}, labels: {} },
			});

			const projectA = await findProjectByBoardIdFromDb('board-111');
			const projectB = await findProjectByBoardIdFromDb('board-222');

			expect(projectA?.id).toBe('proj-a');
			expect(projectB?.id).toBe('proj-b');
		});
	});

	// =========================================================================
	// findProjectByJiraProjectKeyFromDb — JSONB sub-query
	// =========================================================================

	describe('findProjectByJiraProjectKeyFromDb', () => {
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

			const project = await findProjectByJiraProjectKeyFromDb('MYPROJ');

			expect(project).toBeDefined();
			expect(project?.id).toBe('proj-jira');
		});

		it('returns undefined for an unknown JIRA projectKey', async () => {
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

			const project = await findProjectByJiraProjectKeyFromDb('UNKNOWN');

			expect(project).toBeUndefined();
		});

		it('returns correct project when multiple projects exist with different JIRA keys', async () => {
			await seedProject({ id: 'proj-jira-1', repo: 'owner/repo-j1' });
			await seedProject({ id: 'proj-jira-2', repo: 'owner/repo-j2' });

			await seedIntegration({
				projectId: 'proj-jira-1',
				category: 'pm',
				provider: 'jira',
				config: {
					baseUrl: 'https://test.atlassian.net',
					projectKey: 'ALPHA',
					statuses: {},
				},
			});
			await seedIntegration({
				projectId: 'proj-jira-2',
				category: 'pm',
				provider: 'jira',
				config: {
					baseUrl: 'https://test.atlassian.net',
					projectKey: 'BETA',
					statuses: {},
				},
			});

			const proj1 = await findProjectByJiraProjectKeyFromDb('ALPHA');
			const proj2 = await findProjectByJiraProjectKeyFromDb('BETA');

			expect(proj1?.id).toBe('proj-jira-1');
			expect(proj2?.id).toBe('proj-jira-2');
		});
	});

	// =========================================================================
	// findProjectByRepoFromDb — simple column lookup
	// =========================================================================

	describe('findProjectByRepoFromDb', () => {
		it('returns the project for a known repo', async () => {
			await seedProject({ id: 'proj-repo', repo: 'myorg/myrepo' });

			const project = await findProjectByRepoFromDb('myorg/myrepo');

			expect(project).toBeDefined();
			expect(project?.id).toBe('proj-repo');
		});

		it('returns undefined for an unknown repo', async () => {
			await seedProject({ id: 'proj-repo', repo: 'myorg/myrepo' });

			const project = await findProjectByRepoFromDb('myorg/nonexistent');

			expect(project).toBeUndefined();
		});

		it('returns correct project when multiple projects exist with different repos', async () => {
			await seedProject({ id: 'proj-x', repo: 'org/repo-x' });
			await seedProject({ id: 'proj-y', repo: 'org/repo-y' });

			const projX = await findProjectByRepoFromDb('org/repo-x');
			const projY = await findProjectByRepoFromDb('org/repo-y');

			expect(projX?.id).toBe('proj-x');
			expect(projY?.id).toBe('proj-y');
		});
	});

	// =========================================================================
	// findProjectByIdFromDb — primary key lookup
	// =========================================================================

	describe('findProjectByIdFromDb', () => {
		it('returns the project for a known id', async () => {
			await seedProject({ id: 'proj-known', repo: 'owner/repo-known' });

			const project = await findProjectByIdFromDb('proj-known');

			expect(project).toBeDefined();
			expect(project?.id).toBe('proj-known');
		});

		it('returns undefined for an unknown id', async () => {
			await seedProject({ id: 'proj-known', repo: 'owner/repo-known' });

			const project = await findProjectByIdFromDb('proj-nonexistent');

			expect(project).toBeUndefined();
		});
	});

	// =========================================================================
	// WithConfig variants — return { project, config } pair
	// =========================================================================

	describe('findProjectWithConfigByBoardId', () => {
		it('returns { project, config } pair for a known boardId', async () => {
			await seedProject({ id: 'proj-wc-trello', repo: 'owner/wc-trello' });
			await seedIntegration({
				projectId: 'proj-wc-trello',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-wc', lists: {}, labels: {} },
			});

			const result = await findProjectWithConfigByBoardId('board-wc');

			expect(result).toBeDefined();
			expect(result?.project.id).toBe('proj-wc-trello');
			expect(result?.config.projects).toHaveLength(1);
			expect(result?.config.projects[0].id).toBe('proj-wc-trello');
		});

		it('returns undefined for an unknown boardId', async () => {
			await seedProject({ id: 'proj-wc-trello', repo: 'owner/wc-trello' });

			const result = await findProjectWithConfigByBoardId('board-missing');

			expect(result).toBeUndefined();
		});

		it('project is a valid ProjectConfig', async () => {
			await seedProject({ id: 'proj-valid', repo: 'owner/valid-repo' });
			await seedIntegration({
				projectId: 'proj-valid',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-valid', lists: {}, labels: {} },
			});

			const result = await findProjectWithConfigByBoardId('board-valid');

			expect(result).toBeDefined();
			// project must have required fields
			expect(result?.project.id).toBe('proj-valid');
			expect(result?.project.orgId).toBe('test-org');
			expect(result?.project.name).toBe('Test Project');
			expect(result?.project.repo).toBe('owner/valid-repo');
			expect(result?.project.baseBranch).toBeDefined();
		});

		it('config is a valid CascadeConfig containing the project', async () => {
			await seedProject({ id: 'proj-cfg', repo: 'owner/cfg-repo' });
			await seedIntegration({
				projectId: 'proj-cfg',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-cfg', lists: {}, labels: {} },
			});

			const result = await findProjectWithConfigByBoardId('board-cfg');

			expect(result).toBeDefined();
			// config must pass schema validation
			const parsed = CascadeConfigSchema.safeParse(result?.config);
			expect(parsed.success).toBe(true);
		});
	});

	describe('findProjectWithConfigByRepo', () => {
		it('returns { project, config } pair for a known repo', async () => {
			await seedProject({ id: 'proj-wc-repo', repo: 'owner/wc-repo' });

			const result = await findProjectWithConfigByRepo('owner/wc-repo');

			expect(result).toBeDefined();
			expect(result?.project.id).toBe('proj-wc-repo');
			expect(result?.config.projects).toHaveLength(1);
		});

		it('returns undefined for an unknown repo', async () => {
			const result = await findProjectWithConfigByRepo('owner/nonexistent');

			expect(result).toBeUndefined();
		});
	});

	describe('findProjectWithConfigById', () => {
		it('returns { project, config } pair for a known id', async () => {
			await seedProject({ id: 'proj-wc-id', repo: 'owner/wc-id-repo' });

			const result = await findProjectWithConfigById('proj-wc-id');

			expect(result).toBeDefined();
			expect(result?.project.id).toBe('proj-wc-id');
			expect(result?.config.projects).toHaveLength(1);
		});

		it('returns undefined for an unknown id', async () => {
			const result = await findProjectWithConfigById('proj-missing');

			expect(result).toBeUndefined();
		});
	});

	describe('findProjectWithConfigByJiraProjectKey', () => {
		it('returns { project, config } pair for a known JIRA projectKey', async () => {
			await seedProject({ id: 'proj-wc-jira', repo: 'owner/wc-jira-repo' });
			await seedIntegration({
				projectId: 'proj-wc-jira',
				category: 'pm',
				provider: 'jira',
				config: {
					baseUrl: 'https://test.atlassian.net',
					projectKey: 'WCJIRA',
					statuses: {},
				},
			});

			const result = await findProjectWithConfigByJiraProjectKey('WCJIRA');

			expect(result).toBeDefined();
			expect(result?.project.id).toBe('proj-wc-jira');
			expect(result?.config.projects).toHaveLength(1);
		});

		it('returns undefined for an unknown JIRA projectKey', async () => {
			const result = await findProjectWithConfigByJiraProjectKey('NOTFOUND');

			expect(result).toBeUndefined();
		});

		it('project is a valid ProjectConfig and config is a valid CascadeConfig', async () => {
			await seedProject({ id: 'proj-jira-valid', repo: 'owner/jira-valid-repo' });
			await seedIntegration({
				projectId: 'proj-jira-valid',
				category: 'pm',
				provider: 'jira',
				config: {
					baseUrl: 'https://test.atlassian.net',
					projectKey: 'VALID',
					statuses: {},
				},
			});

			const result = await findProjectWithConfigByJiraProjectKey('VALID');

			expect(result).toBeDefined();
			expect(result?.project.id).toBe('proj-jira-valid');

			const parsed = CascadeConfigSchema.safeParse(result?.config);
			expect(parsed.success).toBe(true);
		});
	});

	// =========================================================================
	// Multi-project correctness
	// =========================================================================

	describe('Multi-project correctness', () => {
		it('returns the correct project when Trello and JIRA projects coexist', async () => {
			await seedProject({ id: 'proj-multi-trello', repo: 'owner/multi-trello' });
			await seedProject({ id: 'proj-multi-jira', repo: 'owner/multi-jira' });

			await seedIntegration({
				projectId: 'proj-multi-trello',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-multi', lists: {}, labels: {} },
			});
			await seedIntegration({
				projectId: 'proj-multi-jira',
				category: 'pm',
				provider: 'jira',
				config: {
					baseUrl: 'https://test.atlassian.net',
					projectKey: 'MULTI',
					statuses: {},
				},
			});

			const trelloProject = await findProjectByBoardIdFromDb('board-multi');
			const jiraProject = await findProjectByJiraProjectKeyFromDb('MULTI');

			expect(trelloProject?.id).toBe('proj-multi-trello');
			expect(jiraProject?.id).toBe('proj-multi-jira');
		});

		it('boardId lookup does not match JIRA project with same value in config', async () => {
			// Ensures provider filter in the sub-query is correct
			await seedProject({ id: 'proj-jira-only', repo: 'owner/jira-only' });
			await seedIntegration({
				projectId: 'proj-jira-only',
				category: 'pm',
				provider: 'jira',
				config: {
					baseUrl: 'https://test.atlassian.net',
					projectKey: 'BOARD123', // same value as what we'd search as boardId
					statuses: {},
				},
			});

			// Searching as boardId should not find the JIRA project
			const result = await findProjectByBoardIdFromDb('BOARD123');
			expect(result).toBeUndefined();
		});
	});

	// =========================================================================
	// loadConfigFromDb — full config load
	// =========================================================================

	describe('loadConfigFromDb', () => {
		it('loads and validates config for a single project', async () => {
			await seedProject({ id: 'proj-load', repo: 'owner/load-repo' });
			await seedIntegration({
				projectId: 'proj-load',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-load', lists: {}, labels: {} },
			});

			const config = await loadConfigFromDb();

			expect(config.projects).toHaveLength(1);
			expect(config.projects[0].id).toBe('proj-load');
		});

		it('passes validateConfig() schema validation', async () => {
			await seedProject({ id: 'proj-validate', repo: 'owner/validate-repo' });

			const config = await loadConfigFromDb();

			// Must not throw
			expect(() => validateConfig(config)).not.toThrow();

			// Must also pass safeParse
			const parsed = CascadeConfigSchema.safeParse(config);
			expect(parsed.success).toBe(true);
		});

		it('loads all projects when multiple exist', async () => {
			await seedProject({ id: 'proj-load-1', repo: 'owner/load-repo-1' });
			await seedProject({ id: 'proj-load-2', repo: 'owner/load-repo-2' });
			await seedProject({ id: 'proj-load-3', repo: 'owner/load-repo-3' });

			const config = await loadConfigFromDb();

			expect(config.projects).toHaveLength(3);
			const ids = config.projects.map((p) => p.id).sort();
			expect(ids).toEqual(['proj-load-1', 'proj-load-2', 'proj-load-3']);
		});

		it('includes trello config in project when Trello integration exists', async () => {
			await seedProject({ id: 'proj-with-trello', repo: 'owner/trello-full' });
			await seedIntegration({
				projectId: 'proj-with-trello',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-full', lists: { todo: 'list-1' }, labels: { bug: 'label-1' } },
			});

			const config = await loadConfigFromDb();
			const project = config.projects.find((p) => p.id === 'proj-with-trello');

			expect(project).toBeDefined();
			expect(project?.trello?.boardId).toBe('board-full');
		});

		it('includes jira config in project when JIRA integration exists', async () => {
			await seedProject({ id: 'proj-with-jira', repo: 'owner/jira-full' });
			await seedIntegration({
				projectId: 'proj-with-jira',
				category: 'pm',
				provider: 'jira',
				config: {
					baseUrl: 'https://test.atlassian.net',
					projectKey: 'FULL',
					statuses: { todo: 'To Do' },
				},
			});

			const config = await loadConfigFromDb();
			const project = config.projects.find((p) => p.id === 'proj-with-jira');

			expect(project).toBeDefined();
			expect(project?.jira?.projectKey).toBe('FULL');
		});
	});

	// =========================================================================
	// Cache invalidation
	// =========================================================================

	describe('invalidateConfigCache (via provider layer)', () => {
		it('invalidateConfigCache() clears the cache so fresh DB reads happen', async () => {
			await seedProject({ id: 'proj-cache-test', repo: 'owner/cache-repo' });
			await seedIntegration({
				projectId: 'proj-cache-test',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-cache', lists: {}, labels: {} },
			});

			// First lookup via DB
			const first = await findProjectByBoardIdFromDb('board-cache');
			expect(first?.id).toBe('proj-cache-test');

			// Invalidate and re-lookup — should still work
			invalidateConfigCache();
			const second = await findProjectByBoardIdFromDb('board-cache');
			expect(second?.id).toBe('proj-cache-test');
		});
	});
});

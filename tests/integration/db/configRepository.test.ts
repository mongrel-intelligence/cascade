import { beforeEach, describe, expect, it } from 'vitest';
import { CascadeConfigSchema, validateConfig } from '../../../src/config/schema.js';
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
} from '../../../src/db/repositories/configRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedAgentConfig, seedIntegration, seedOrg, seedProject } from '../helpers/seed.js';

describe('configRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// loadConfigFromDb
	// =========================================================================

	describe('loadConfigFromDb', () => {
		it('returns a valid CascadeConfig with no data beyond org+project', async () => {
			const config = await loadConfigFromDb();
			expect(config).toBeDefined();
			expect(config.projects).toHaveLength(1);
			expect(config.projects[0].id).toBe('test-project');
		});

		it('uses project schema defaults when no project-specific overrides', async () => {
			const config = await loadConfigFromDb();
			const project = config.projects[0];
			expect(project.model).toBeDefined();
			expect(project.maxIterations).toBeGreaterThan(0);
		});

		it('includes trello integration config in project', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-123', lists: {}, labels: {} },
			});
			const config = await loadConfigFromDb();
			const project = config.projects[0];
			expect(project.trello?.boardId).toBe('board-123');
		});

		it('applies project-level agent config overrides to project.agentModels', async () => {
			await seedAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'project-impl-model',
			});
			const config = await loadConfigFromDb();
			const project = config.projects[0];
			expect(project.agentModels?.implementation).toBe('project-impl-model');
		});

		it('handles multiple projects', async () => {
			await seedProject({ id: 'project-2', name: 'Project 2', repo: 'owner/repo2' });
			const config = await loadConfigFromDb();
			expect(config.projects).toHaveLength(2);
			expect(config.projects.map((p) => p.id).sort()).toEqual(['project-2', 'test-project']);
		});
	});

	// =========================================================================
	// findProjectByBoardIdFromDb
	// =========================================================================

	describe('findProjectByBoardIdFromDb', () => {
		it('finds a project by its Trello board ID', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-abc', lists: {}, labels: {} },
			});
			const project = await findProjectByBoardIdFromDb('board-abc');
			expect(project).toBeDefined();
			expect(project?.id).toBe('test-project');
		});

		it('returns undefined for non-existent board ID', async () => {
			const project = await findProjectByBoardIdFromDb('nonexistent-board');
			expect(project).toBeUndefined();
		});
	});

	// =========================================================================
	// findProjectByRepoFromDb
	// =========================================================================

	describe('findProjectByRepoFromDb', () => {
		it('finds a project by its repo', async () => {
			const project = await findProjectByRepoFromDb('owner/repo');
			expect(project).toBeDefined();
			expect(project?.id).toBe('test-project');
		});

		it('returns undefined for non-existent repo', async () => {
			const project = await findProjectByRepoFromDb('nonexistent/repo');
			expect(project).toBeUndefined();
		});
	});

	// =========================================================================
	// findProjectByIdFromDb
	// =========================================================================

	describe('findProjectByIdFromDb', () => {
		it('finds a project by its ID', async () => {
			const project = await findProjectByIdFromDb('test-project');
			expect(project).toBeDefined();
			expect(project?.id).toBe('test-project');
			expect(project?.orgId).toBe('test-org');
		});

		it('returns undefined for non-existent ID', async () => {
			const project = await findProjectByIdFromDb('nonexistent-project');
			expect(project).toBeUndefined();
		});
	});

	// =========================================================================
	// findProjectByJiraProjectKeyFromDb
	// =========================================================================

	describe('findProjectByJiraProjectKeyFromDb', () => {
		it('finds a project by its JIRA project key', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'jira',
				config: {
					projectKey: 'PROJ',
					baseUrl: 'https://example.atlassian.net',
					statuses: { splitting: 'Splitting', todo: 'To Do' },
				},
			});
			const project = await findProjectByJiraProjectKeyFromDb('PROJ');
			expect(project).toBeDefined();
			expect(project?.id).toBe('test-project');
		});

		it('returns undefined for non-existent JIRA project key', async () => {
			const project = await findProjectByJiraProjectKeyFromDb('NONEXISTENT');
			expect(project).toBeUndefined();
		});
	});

	// =========================================================================
	// findProjectWithConfigByBoardId
	// =========================================================================

	describe('findProjectWithConfigByBoardId', () => {
		it('returns both project and config', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-xyz', lists: {}, labels: {} },
			});
			const result = await findProjectWithConfigByBoardId('board-xyz');
			expect(result).toBeDefined();
			expect(result?.project.id).toBe('test-project');
			expect(result?.config).toBeDefined();
			expect(result?.config.projects).toBeDefined();
		});

		it('returns undefined for non-existent board', async () => {
			const result = await findProjectWithConfigByBoardId('no-such-board');
			expect(result).toBeUndefined();
		});
	});

	// =========================================================================
	// Multi-project config loading
	// =========================================================================

	describe('multi-project config loading', () => {
		it('correctly loads integrations for each project separately', async () => {
			await seedProject({ id: 'project-2', name: 'Project 2', repo: 'owner/repo2' });
			await seedIntegration({
				projectId: 'test-project',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-project-1', lists: {}, labels: {} },
			});
			await seedIntegration({
				projectId: 'project-2',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-project-2', lists: {}, labels: {} },
			});
			const config = await loadConfigFromDb();
			expect(config.projects).toHaveLength(2);
			const p1 = config.projects.find((p) => p.id === 'test-project');
			const p2 = config.projects.find((p) => p.id === 'project-2');
			expect(p1?.trello?.boardId).toBe('board-project-1');
			expect(p2?.trello?.boardId).toBe('board-project-2');
		});

		it('returns the correct project when Trello and JIRA projects coexist', async () => {
			await seedProject({ id: 'project-jira', name: 'JIRA Project', repo: 'owner/jira-repo' });
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-mixed', lists: {}, labels: {} },
			});
			await seedIntegration({
				projectId: 'project-jira',
				category: 'pm',
				provider: 'jira',
				config: {
					baseUrl: 'https://test.atlassian.net',
					projectKey: 'MIXED',
					statuses: {},
				},
			});

			const trelloProject = await findProjectByBoardIdFromDb('board-mixed');
			const jiraProject = await findProjectByJiraProjectKeyFromDb('MIXED');

			expect(trelloProject?.id).toBe('test-project');
			expect(jiraProject?.id).toBe('project-jira');
		});

		it('boardId lookup does not match JIRA project with same value in config', async () => {
			// Ensures the provider filter in the JSONB sub-query is correct
			await seedIntegration({
				category: 'pm',
				provider: 'jira',
				config: {
					baseUrl: 'https://test.atlassian.net',
					projectKey: 'BOARD123',
					statuses: {},
				},
			});

			// Searching as boardId should not find the JIRA project
			const result = await findProjectByBoardIdFromDb('BOARD123');
			expect(result).toBeUndefined();
		});
	});

	// =========================================================================
	// loadConfigFromDb — schema validation and JIRA config
	// =========================================================================

	describe('loadConfigFromDb — validation and JIRA', () => {
		it('passes validateConfig() schema validation', async () => {
			const config = await loadConfigFromDb();

			// Must not throw
			expect(() => validateConfig(config)).not.toThrow();

			// Must also pass safeParse
			const parsed = CascadeConfigSchema.safeParse(config);
			expect(parsed.success).toBe(true);
		});

		it('includes jira config in project when JIRA integration exists', async () => {
			await seedIntegration({
				category: 'pm',
				provider: 'jira',
				config: {
					baseUrl: 'https://test.atlassian.net',
					projectKey: 'FULL',
					statuses: { todo: 'To Do' },
				},
			});

			const config = await loadConfigFromDb();
			const project = config.projects[0];

			expect(project).toBeDefined();
			expect(project?.jira?.projectKey).toBe('FULL');
		});
	});

	// =========================================================================
	// findProjectWithConfigByRepo — { project, config } pair
	// =========================================================================

	describe('findProjectWithConfigByRepo', () => {
		it('returns { project, config } pair for a known repo', async () => {
			const result = await findProjectWithConfigByRepo('owner/repo');

			expect(result).toBeDefined();
			expect(result?.project.id).toBe('test-project');
			expect(result?.config.projects).toHaveLength(1);
		});

		it('returns undefined for an unknown repo', async () => {
			const result = await findProjectWithConfigByRepo('owner/nonexistent');

			expect(result).toBeUndefined();
		});

		it('config passes CascadeConfigSchema.safeParse()', async () => {
			const result = await findProjectWithConfigByRepo('owner/repo');

			expect(result).toBeDefined();
			const parsed = CascadeConfigSchema.safeParse(result?.config);
			expect(parsed.success).toBe(true);
		});
	});

	// =========================================================================
	// findProjectWithConfigById — { project, config } pair
	// =========================================================================

	describe('findProjectWithConfigById', () => {
		it('returns { project, config } pair for a known id', async () => {
			const result = await findProjectWithConfigById('test-project');

			expect(result).toBeDefined();
			expect(result?.project.id).toBe('test-project');
			expect(result?.config.projects).toHaveLength(1);
		});

		it('returns undefined for an unknown id', async () => {
			const result = await findProjectWithConfigById('proj-missing');

			expect(result).toBeUndefined();
		});

		it('config passes CascadeConfigSchema.safeParse()', async () => {
			const result = await findProjectWithConfigById('test-project');

			expect(result).toBeDefined();
			const parsed = CascadeConfigSchema.safeParse(result?.config);
			expect(parsed.success).toBe(true);
		});
	});

	// =========================================================================
	// findProjectWithConfigByJiraProjectKey — { project, config } pair
	// =========================================================================

	describe('findProjectWithConfigByJiraProjectKey', () => {
		it('returns { project, config } pair for a known JIRA projectKey', async () => {
			await seedIntegration({
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
			expect(result?.project.id).toBe('test-project');
			expect(result?.config.projects).toHaveLength(1);
		});

		it('returns undefined for an unknown JIRA projectKey', async () => {
			const result = await findProjectWithConfigByJiraProjectKey('NOTFOUND');

			expect(result).toBeUndefined();
		});

		it('config passes CascadeConfigSchema.safeParse()', async () => {
			await seedIntegration({
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
			const parsed = CascadeConfigSchema.safeParse(result?.config);
			expect(parsed.success).toBe(true);
		});
	});
});

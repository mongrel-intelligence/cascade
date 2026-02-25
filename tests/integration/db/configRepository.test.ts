import { beforeEach, describe, expect, it } from 'vitest';
import {
	findProjectByBoardIdFromDb,
	findProjectByIdFromDb,
	findProjectByJiraProjectKeyFromDb,
	findProjectByRepoFromDb,
	findProjectWithConfigByBoardId,
	loadConfigFromDb,
} from '../../../src/db/repositories/configRepository.js';
import { truncateAll } from '../helpers/db.js';
import {
	seedAgentConfig,
	seedDefaults,
	seedIntegration,
	seedOrg,
	seedProject,
} from '../helpers/seed.js';

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

		it('includes defaults when cascade_defaults row exists', async () => {
			await seedDefaults({ model: 'claude-opus-4-5', maxIterations: 30 });
			const config = await loadConfigFromDb();
			expect(config.defaults.model).toBe('claude-opus-4-5');
			expect(config.defaults.maxIterations).toBe(30);
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

		it('handles multiple projects', async () => {
			await seedProject({ id: 'project-2', name: 'Project 2', repo: 'owner/repo2' });
			const config = await loadConfigFromDb();
			expect(config.projects).toHaveLength(2);
			expect(config.projects.map((p) => p.id).sort()).toEqual(['project-2', 'test-project']);
		});

		it('applies global agent config model overrides to defaults.agentModels', async () => {
			await seedDefaults();
			await seedAgentConfig({
				orgId: null,
				projectId: null,
				agentType: 'implementation',
				model: 'global-impl-model',
			});
			const config = await loadConfigFromDb();
			expect(config.defaults.agentModels.implementation).toBe('global-impl-model');
		});

		it('applies global agent config iteration overrides to defaults.agentIterations', async () => {
			await seedDefaults();
			await seedAgentConfig({
				orgId: null,
				projectId: null,
				agentType: 'implementation',
				maxIterations: 25,
			});
			const config = await loadConfigFromDb();
			expect(config.defaults.agentIterations.implementation).toBe(25);
		});

		it('applies org-level agent config overrides to defaults.agentModels', async () => {
			await seedDefaults();
			await seedAgentConfig({
				orgId: 'test-org',
				projectId: null,
				agentType: 'review',
				model: 'org-review-model',
			});
			const config = await loadConfigFromDb();
			expect(config.defaults.agentModels.review).toBe('org-review-model');
		});

		it('applies project-level agent config overrides to project.agentModels', async () => {
			await seedAgentConfig({
				orgId: null,
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'project-impl-model',
			});
			const config = await loadConfigFromDb();
			const project = config.projects[0];
			expect(project.agentModels?.implementation).toBe('project-impl-model');
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
			await seedDefaults({ model: 'claude-sonnet' });
			await seedIntegration({
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-xyz', lists: {}, labels: {} },
			});
			const result = await findProjectWithConfigByBoardId('board-xyz');
			expect(result).toBeDefined();
			expect(result?.project.id).toBe('test-project');
			expect(result?.config).toBeDefined();
			expect(result?.config.defaults.model).toBe('claude-sonnet');
		});

		it('returns undefined for non-existent board', async () => {
			const result = await findProjectWithConfigByBoardId('no-such-board');
			expect(result).toBeUndefined();
		});
	});

	// =========================================================================
	// Agent config inheritance: global → org → project
	// =========================================================================

	describe('agent config inheritance', () => {
		it('project agentModels overrides global agentModels for the same agent', async () => {
			await seedDefaults();
			await seedAgentConfig({
				orgId: null,
				projectId: null,
				agentType: 'implementation',
				model: 'global-model',
			});
			await seedAgentConfig({
				orgId: null,
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'project-model',
			});
			const config = await loadConfigFromDb();
			const project = config.projects[0];
			// Project-level agentModels should take precedence
			expect(project.agentModels?.implementation).toBe('project-model');
			// Global-level should be in defaults
			expect(config.defaults.agentModels.implementation).toBe('global-model');
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
	});
});

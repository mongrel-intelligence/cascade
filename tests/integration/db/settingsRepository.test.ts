import { beforeEach, describe, expect, it } from 'vitest';
import {
	listProjectCredentials,
	writeProjectCredential,
} from '../../../src/db/repositories/credentialsRepository.js';
import {
	createAgentConfig,
	createProject,
	deleteAgentConfig,
	deleteProject,
	deleteProjectIntegration,
	getOrganization,
	getProjectFull,
	listAgentConfigs,
	listAllOrganizations,
	listProjectIntegrations,
	listProjectsFull,
	removeIntegrationCredential,
	updateAgentConfig,
	updateOrganization,
	updateProject,
	updateProjectIntegrationTriggers,
	upsertProjectIntegration,
} from '../../../src/db/repositories/settingsRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedIntegration, seedOrg, seedProject } from '../helpers/seed.js';

describe('settingsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// Organizations
	// =========================================================================

	describe('getOrganization', () => {
		it('returns the organization', async () => {
			const org = await getOrganization('test-org');
			expect(org).toBeDefined();
			expect(org?.id).toBe('test-org');
			expect(org?.name).toBe('Test Org');
		});

		it('returns null for non-existent org', async () => {
			const org = await getOrganization('nonexistent-org');
			expect(org).toBeNull();
		});
	});

	describe('updateOrganization', () => {
		it('updates the org name', async () => {
			await updateOrganization('test-org', { name: 'Updated Org Name' });
			const org = await getOrganization('test-org');
			expect(org?.name).toBe('Updated Org Name');
		});
	});

	describe('listAllOrganizations', () => {
		it('returns all organizations', async () => {
			await seedOrg('org-2', 'Org 2');
			const orgs = await listAllOrganizations();
			expect(orgs.length).toBeGreaterThanOrEqual(2);
			expect(orgs.map((o) => o.id)).toContain('test-org');
			expect(orgs.map((o) => o.id)).toContain('org-2');
		});
	});

	// =========================================================================
	// Projects
	// =========================================================================

	describe('createProject', () => {
		it('creates a new project', async () => {
			const project = await createProject('test-org', {
				id: 'new-project',
				name: 'New Project',
				repo: 'owner/new-repo',
			});
			expect(project.id).toBe('new-project');
			expect(project.orgId).toBe('test-org');
			expect(project.name).toBe('New Project');
			expect(project.baseBranch).toBe('main');
		});

		it('creates a project with optional fields', async () => {
			const project = await createProject('test-org', {
				id: 'proj-opts',
				name: 'Opts Project',
				repo: 'owner/opts-repo',
				baseBranch: 'develop',
				branchPrefix: 'fix/',
				model: 'claude-sonnet',
				workItemBudgetUsd: '10.00',
				agentEngine: 'claude-code',
			});
			expect(project.baseBranch).toBe('develop');
			expect(project.branchPrefix).toBe('fix/');
			expect(project.model).toBe('claude-sonnet');
		});
	});

	describe('updateProject', () => {
		it('updates project fields', async () => {
			await updateProject('test-project', 'test-org', {
				name: 'Updated Project',
				model: 'claude-haiku',
			});
			const project = await getProjectFull('test-project', 'test-org');
			expect(project?.name).toBe('Updated Project');
			expect(project?.model).toBe('claude-haiku');
		});
	});

	describe('deleteProject', () => {
		it('deletes a project', async () => {
			await deleteProject('test-project', 'test-org');
			const project = await getProjectFull('test-project', 'test-org');
			expect(project).toBeNull();
		});
	});

	describe('listProjectsFull', () => {
		it('returns all projects for an org', async () => {
			await seedProject({ id: 'project-2', name: 'Project 2', repo: 'owner/repo2' });
			const projects = await listProjectsFull('test-org');
			expect(projects).toHaveLength(2);
		});
	});

	describe('getProjectFull', () => {
		it('returns the full project', async () => {
			const project = await getProjectFull('test-project', 'test-org');
			expect(project).toBeDefined();
			expect(project?.id).toBe('test-project');
			expect(project?.orgId).toBe('test-org');
			expect(project?.repo).toBe('owner/repo');
		});

		it('returns null for wrong org', async () => {
			const project = await getProjectFull('test-project', 'wrong-org');
			expect(project).toBeNull();
		});
	});

	// =========================================================================
	// Project Integrations
	// =========================================================================

	describe('upsertProjectIntegration', () => {
		it('inserts a new integration', async () => {
			const integration = await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-123',
			});
			expect(integration.projectId).toBe('test-project');
			expect(integration.category).toBe('pm');
			expect(integration.provider).toBe('trello');
		});

		it('updates an existing integration on conflict', async () => {
			await upsertProjectIntegration('test-project', 'pm', 'trello', { boardId: 'board-old' });
			const updated = await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-new',
			});
			expect((updated.config as Record<string, unknown>).boardId).toBe('board-new');
		});

		it('preserves existing triggers when not provided', async () => {
			await upsertProjectIntegration(
				'test-project',
				'pm',
				'trello',
				{ boardId: 'board-1' },
				{ cardMovedToTodo: true },
			);
			// Upsert without triggers — should preserve existing
			const updated = await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-2',
			});
			expect((updated.triggers as Record<string, unknown>).cardMovedToTodo).toBe(true);
		});
	});

	describe('updateProjectIntegrationTriggers', () => {
		it('deep-merges triggers', async () => {
			await upsertProjectIntegration(
				'test-project',
				'pm',
				'trello',
				{},
				{ cardMovedToTodo: true, cardMovedToPlanning: true },
			);

			await updateProjectIntegrationTriggers('test-project', 'pm', {
				cardMovedToTodo: false,
				reviewTrigger: { ownPrsOnly: true },
			});

			const integrations = await listProjectIntegrations('test-project');
			const pmIntegration = integrations.find((i) => i.category === 'pm');
			const triggers = pmIntegration?.triggers as Record<string, unknown>;
			expect(triggers.cardMovedToTodo).toBe(false);
			expect(triggers.cardMovedToPlanning).toBe(true); // preserved
			expect((triggers.reviewTrigger as Record<string, unknown>).ownPrsOnly).toBe(true);
		});

		it('throws when no integration found', async () => {
			await expect(
				updateProjectIntegrationTriggers('test-project', 'scm', { ownPrsOnly: true }),
			).rejects.toThrow();
		});
	});

	describe('deleteProjectIntegration', () => {
		it('deletes a project integration', async () => {
			await upsertProjectIntegration('test-project', 'pm', 'trello', {});
			await deleteProjectIntegration('test-project', 'pm');
			const integrations = await listProjectIntegrations('test-project');
			expect(integrations.find((i) => i.category === 'pm')).toBeUndefined();
		});
	});

	// =========================================================================
	// Integration Credentials (via project_credentials)
	// =========================================================================

	describe('removeIntegrationCredential', () => {
		it('removes a project credential by integration role', async () => {
			const integration = await seedIntegration({ category: 'scm', provider: 'github' });
			// Write the credential directly to project_credentials
			await writeProjectCredential(
				'test-project',
				'GITHUB_TOKEN_IMPLEMENTER',
				'ghp_123',
				'Implementer Token',
			);

			// Verify it exists
			const credsBeforeRemoval = await listProjectCredentials('test-project');
			expect(
				credsBeforeRemoval.find((c) => c.envVarKey === 'GITHUB_TOKEN_IMPLEMENTER'),
			).toBeDefined();

			// Remove via integration role
			await removeIntegrationCredential(integration.id, 'implementer_token');

			// Should be removed from project_credentials
			const credsAfterRemoval = await listProjectCredentials('test-project');
			expect(
				credsAfterRemoval.find((c) => c.envVarKey === 'GITHUB_TOKEN_IMPLEMENTER'),
			).toBeUndefined();
		});

		it('does nothing when no credential exists for the role', async () => {
			const integration = await seedIntegration({ category: 'scm', provider: 'github' });

			// Should not throw even when credential doesn't exist
			await expect(
				removeIntegrationCredential(integration.id, 'implementer_token'),
			).resolves.toBeUndefined();
		});
	});

	// =========================================================================
	// Agent Configs (project-scoped only after migration 0036)
	// =========================================================================

	describe('listAgentConfigs', () => {
		it('lists agent configs for a project', async () => {
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'impl-model',
			});
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'review',
				model: 'review-model',
			});

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs).toHaveLength(2);
			expect(configs.every((c) => c.projectId === 'test-project')).toBe(true);
		});

		it('returns empty list for project with no configs', async () => {
			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs).toHaveLength(0);
		});

		it('only returns configs for the specified project', async () => {
			await seedProject({ id: 'project-2', name: 'Project 2', repo: 'owner/repo2' });
			await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'proj1-model',
			});
			await createAgentConfig({
				projectId: 'project-2',
				agentType: 'implementation',
				model: 'proj2-model',
			});

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs).toHaveLength(1);
			expect(configs[0].model).toBe('proj1-model');
		});
	});

	describe('createAgentConfig', () => {
		it('creates a project-scoped agent config', async () => {
			const { id } = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'claude-opus-4-5',
				maxIterations: 30,
			});
			expect(id).toBeGreaterThan(0);

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs.find((c) => c.id === id)?.model).toBe('claude-opus-4-5');
		});

		it('creates a config with engine and max concurrency', async () => {
			const { id } = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'review',
				model: 'claude-sonnet',
				agentEngine: 'claude-code',
				maxConcurrency: 3,
			});
			expect(id).toBeGreaterThan(0);
		});
	});

	describe('updateAgentConfig', () => {
		it('updates an agent config', async () => {
			const { id } = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'old-model',
				maxIterations: 10,
			});

			await updateAgentConfig(id, { model: 'new-model', maxIterations: 20 });

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			const config = configs.find((c) => c.id === id);
			expect(config?.model).toBe('new-model');
			expect(config?.maxIterations).toBe(20);
		});
	});

	describe('deleteAgentConfig', () => {
		it('deletes an agent config', async () => {
			const { id } = await createAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'to-delete',
			});

			await deleteAgentConfig(id);

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs.find((c) => c.id === id)).toBeUndefined();
		});
	});
});

/**
 * Integration tests: Database Repository Edge Cases
 *
 * Tests complex queries, transactions, constraint enforcement, and cascade
 * deletes. Covers the 4-level agent config resolution and FK constraints.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfigFromDb } from '../../../src/db/repositories/configRepository.js';
import {
	deleteProjectCredential,
	listProjectCredentials,
	writeProjectCredential,
} from '../../../src/db/repositories/credentialsRepository.js';
import {
	createProject,
	deleteProject,
	getIntegrationByProjectAndCategory,
	getOrganization,
	listAgentConfigs,
	listProjectIntegrations,
	listProjectsFull,
	updateOrganization,
	updateProjectIntegrationTriggers,
	upsertProjectIntegration,
} from '../../../src/db/repositories/settingsRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedAgentConfig, seedIntegration, seedOrg, seedProject } from '../helpers/seed.js';

describe('Database Repository Edge Cases (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// Agent Config Project-Level Resolution
	// =========================================================================

	describe('agent config project-level resolution', () => {
		it('applies project-level agent config model override', async () => {
			await seedAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'project-model',
				maxIterations: 30,
			});

			const config = await loadConfigFromDb();
			const project = config.projects[0];
			expect(project.agentModels?.implementation).toBe('project-model');
		});

		it('handles multiple agent types with independent project overrides', async () => {
			await seedAgentConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'project-impl-model',
			});

			const config = await loadConfigFromDb();
			const project = config.projects[0];

			expect(project.agentModels?.implementation).toBe('project-impl-model');
			// review not overridden at project level
			expect(project.agentModels?.review).toBeUndefined();
		});
	});

	// =========================================================================
	// Credential CRUD (project-scoped)
	// =========================================================================

	describe('credential CRUD', () => {
		it('writes and reads a project credential', async () => {
			await writeProjectCredential('test-project', 'SOME_KEY', 'old-value', 'Old Name');

			const all = await listProjectCredentials('test-project');
			const cred = all.find((c) => c.envVarKey === 'SOME_KEY');
			expect(cred?.name).toBe('Old Name');
			expect(cred?.value).toBe('old-value');
		});

		it('upserts (overwrites) when writing same key again', async () => {
			await writeProjectCredential('test-project', 'SOME_KEY', 'old-value', 'Old Name');
			await writeProjectCredential('test-project', 'SOME_KEY', 'new-value', 'New Name');

			const all = await listProjectCredentials('test-project');
			const updated = all.find((c) => c.envVarKey === 'SOME_KEY');
			expect(updated?.name).toBe('New Name');
			expect(updated?.value).toBe('new-value');
		});

		it('deletes a project credential', async () => {
			await writeProjectCredential('test-project', 'DEL_KEY', 'val');
			await deleteProjectCredential('test-project', 'DEL_KEY');

			const all = await listProjectCredentials('test-project');
			expect(all.find((c) => c.envVarKey === 'DEL_KEY')).toBeUndefined();
		});

		it('lists all credentials for a project', async () => {
			await writeProjectCredential('test-project', 'KEY_1', 'val1', 'Cred 1');
			await writeProjectCredential('test-project', 'KEY_2', 'val2', 'Cred 2');
			await writeProjectCredential('test-project', 'KEY_3', 'val3', 'Cred 3');

			const all = await listProjectCredentials('test-project');
			expect(all).toHaveLength(3);
			expect(all.map((c) => c.name).sort()).toEqual(['Cred 1', 'Cred 2', 'Cred 3']);
		});
	});

	// =========================================================================
	// Project Integration CRUD
	// =========================================================================

	describe('project integration upsert', () => {
		it('inserts a new integration', async () => {
			await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-1',
				lists: {},
				labels: {},
			});

			const integ = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect(integ).toBeDefined();
			expect(integ?.provider).toBe('trello');
			expect((integ?.config as Record<string, unknown>)?.boardId).toBe('board-1');
		});

		it('updates existing integration on conflict', async () => {
			await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-old',
				lists: {},
				labels: {},
			});

			// Switch to JIRA (same category = pm)
			await upsertProjectIntegration('test-project', 'pm', 'jira', {
				projectKey: 'PROJ',
				baseUrl: 'https://example.atlassian.net',
				statuses: { todo: 'To Do' },
			});

			const integ = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect(integ?.provider).toBe('jira');
			expect((integ?.config as Record<string, unknown>)?.projectKey).toBe('PROJ');
		});

		it('preserves existing triggers when not provided', async () => {
			await upsertProjectIntegration(
				'test-project',
				'pm',
				'trello',
				{ boardId: 'board-1', lists: {}, labels: {} },
				{ cardMovedToTodo: false },
			);

			// Update config without providing triggers — should preserve them
			await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-updated',
				lists: {},
				labels: {},
			});

			const integ = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect((integ?.triggers as Record<string, boolean>)?.cardMovedToTodo).toBe(false);
		});
	});

	// =========================================================================
	// Integration Trigger Deep Merge
	// =========================================================================

	describe('updateProjectIntegrationTriggers', () => {
		it('merges triggers without overwriting existing keys', async () => {
			await upsertProjectIntegration(
				'test-project',
				'pm',
				'trello',
				{ boardId: 'board-1', lists: {}, labels: {} },
				{ cardMovedToTodo: true, cardMovedToPlanning: true },
			);

			await updateProjectIntegrationTriggers('test-project', 'pm', { cardMovedToTodo: false });

			const integ = await getIntegrationByProjectAndCategory('test-project', 'pm');
			const triggers = integ?.triggers as Record<string, boolean>;
			expect(triggers?.cardMovedToTodo).toBe(false);
			expect(triggers?.cardMovedToPlanning).toBe(true); // Not touched
		});

		it('merges nested trigger objects', async () => {
			await upsertProjectIntegration(
				'test-project',
				'pm',
				'jira',
				{
					projectKey: 'PROJ',
					baseUrl: 'https://example.atlassian.net',
					statuses: {},
				},
				{ issueTransitioned: { splitting: true, planning: true, implementation: true } },
			);

			await updateProjectIntegrationTriggers('test-project', 'pm', {
				issueTransitioned: { implementation: false },
			});

			const integ = await getIntegrationByProjectAndCategory('test-project', 'pm');
			const triggers = integ?.triggers as Record<string, Record<string, boolean>>;
			expect(triggers?.issueTransitioned?.splitting).toBe(true);
			expect(triggers?.issueTransitioned?.planning).toBe(true);
			expect(triggers?.issueTransitioned?.implementation).toBe(false);
		});

		it('throws when integration does not exist', async () => {
			await expect(
				updateProjectIntegrationTriggers('test-project', 'pm', { cardMovedToTodo: false }),
			).rejects.toThrow('No pm integration found for project test-project');
		});
	});

	// =========================================================================
	// Cascade Deletes
	// =========================================================================

	describe('cascade deletes', () => {
		it('deleting a project removes its integrations', async () => {
			await seedIntegration({
				projectId: 'test-project',
				category: 'pm',
				provider: 'trello',
			});
			await seedIntegration({
				projectId: 'test-project',
				category: 'scm',
				provider: 'github',
			});

			let integrations = await listProjectIntegrations('test-project');
			expect(integrations).toHaveLength(2);

			await deleteProject('test-project', 'test-org');

			integrations = await listProjectIntegrations('test-project');
			expect(integrations).toHaveLength(0);
		});

		it('deleting a project removes its agent configs', async () => {
			await seedAgentConfig({ projectId: 'test-project', agentType: 'implementation' });
			await seedAgentConfig({ projectId: 'test-project', agentType: 'review' });

			const configs = await listAgentConfigs({ projectId: 'test-project' });
			expect(configs).toHaveLength(2);

			await deleteProject('test-project', 'test-org');

			const configsAfter = await listAgentConfigs({ projectId: 'test-project' });
			expect(configsAfter.filter((c) => c.projectId === 'test-project')).toHaveLength(0);
		});
	});

	// =========================================================================
	// DB Constraints
	// =========================================================================

	describe('database constraints', () => {
		it('enforces unique PM integration per project (upsert handles conflict)', async () => {
			// This should work via upsert (on-conflict-do-update)
			await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-1',
				lists: {},
				labels: {},
			});
			await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-2',
				lists: {},
				labels: {},
			});

			// Should still only be one PM integration
			const integrations = await listProjectIntegrations('test-project');
			const pmIntegrations = integrations.filter((i) => i.category === 'pm');
			expect(pmIntegrations).toHaveLength(1);
			expect((pmIntegrations[0].config as Record<string, unknown>)?.boardId).toBe('board-2');
		});

		it('writing same key twice upserts (overwrites) project credential', async () => {
			await writeProjectCredential('test-project', 'TRELLO_API_KEY', 'val1', 'First Key');
			await writeProjectCredential('test-project', 'TRELLO_API_KEY', 'val2', 'Second Key');

			const all = await listProjectCredentials('test-project');
			const cred = all.find((c) => c.envVarKey === 'TRELLO_API_KEY');
			expect(cred?.value).toBe('val2');
		});
	});

	// =========================================================================
	// Settings Repository Operations
	// =========================================================================

	describe('organization settings', () => {
		it('updates org name', async () => {
			await updateOrganization('test-org', { name: 'Updated Org Name' });

			const org = await getOrganization('test-org');
			expect(org?.name).toBe('Updated Org Name');
		});

		it('returns null for non-existent org', async () => {
			const org = await getOrganization('nonexistent-org');
			expect(org).toBeNull();
		});
	});

	describe('project full CRUD', () => {
		it('creates and retrieves a project', async () => {
			await createProject('test-org', {
				id: 'new-proj',
				name: 'New Project',
				repo: 'owner/new-repo',
				baseBranch: 'main',
			});

			const projects = await listProjectsFull('test-org');
			expect(projects.find((p) => p.id === 'new-proj')).toBeDefined();
		});

		it('lists all projects for an org', async () => {
			await seedProject({ id: 'proj-2', name: 'Project 2', repo: 'owner/repo2' });

			const projects = await listProjectsFull('test-org');
			expect(projects).toHaveLength(2); // test-project + proj-2
		});

		it('returns empty list for org with no projects after deletion', async () => {
			await deleteProject('test-project', 'test-org');

			const projects = await listProjectsFull('test-org');
			expect(projects).toHaveLength(0);
		});
	});
});

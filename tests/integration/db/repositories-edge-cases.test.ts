/**
 * Integration tests: Database Repository Edge Cases
 *
 * Tests complex queries, transactions, constraint enforcement, and cascade
 * deletes. Covers the 4-level agent config resolution and FK constraints.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfigFromDb } from '../../../src/db/repositories/configRepository.js';
import {
	deleteCredential,
	listOrgCredentials,
	updateCredential,
} from '../../../src/db/repositories/credentialsRepository.js';
import {
	createProject,
	deleteProject,
	getIntegrationByProjectAndCategory,
	getOrganization,
	listAgentConfigs,
	listProjectIntegrations,
	listProjectsFull,
	setIntegrationCredential,
	updateOrganization,
	updateProjectIntegrationTriggers,
	upsertCascadeDefaults,
	upsertProjectIntegration,
} from '../../../src/db/repositories/settingsRepository.js';
import { truncateAll } from '../helpers/db.js';
import {
	seedAgentConfig,
	seedCredential,
	seedDefaults,
	seedIntegration,
	seedIntegrationCredential,
	seedOrg,
	seedProject,
} from '../helpers/seed.js';

describe('Database Repository Edge Cases (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// Agent Config 4-Level Resolution Cascade
	// =========================================================================

	describe('agent config resolution cascade', () => {
		it('resolves global → org → project config hierarchy', async () => {
			await seedDefaults();

			// Global (no org, no project)
			await seedAgentConfig({
				orgId: null,
				projectId: null,
				agentType: 'implementation',
				model: 'global-model',
				maxIterations: 10,
			});

			// Org-level (org set, no project)
			await seedAgentConfig({
				orgId: 'test-org',
				projectId: null,
				agentType: 'implementation',
				model: 'org-model',
				maxIterations: 20,
			});

			// Project-level (project set)
			await seedAgentConfig({
				orgId: null,
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'project-model',
				maxIterations: 30,
			});

			const config = await loadConfigFromDb();

			// Global defaults should reflect global agent config
			expect(config.defaults.agentModels.implementation).toBe('org-model');

			// Project-level config should override
			const project = config.projects[0];
			expect(project.agentModels?.implementation).toBe('project-model');
		});

		it('handles multiple agent types with independent overrides', async () => {
			await seedDefaults();

			await seedAgentConfig({
				orgId: null,
				projectId: null,
				agentType: 'implementation',
				model: 'global-impl-model',
			});
			await seedAgentConfig({
				orgId: null,
				projectId: null,
				agentType: 'review',
				model: 'global-review-model',
			});

			// Project overrides only implementation
			await seedAgentConfig({
				orgId: null,
				projectId: 'test-project',
				agentType: 'implementation',
				model: 'project-impl-model',
			});

			const config = await loadConfigFromDb();
			const project = config.projects[0];

			expect(project.agentModels?.implementation).toBe('project-impl-model');
			// review not overridden at project level
			expect(project.agentModels?.review).toBeUndefined();
			// Global still has review model
			expect(config.defaults.agentModels.review).toBe('global-review-model');
		});
	});

	// =========================================================================
	// Credential CRUD
	// =========================================================================

	describe('credential CRUD', () => {
		it('updates credential name and value', async () => {
			const cred = await seedCredential({
				name: 'Old Name',
				envVarKey: 'SOME_KEY',
				value: 'old-value',
			});

			await updateCredential(cred.id, { name: 'New Name', value: 'new-value' });

			const all = await listOrgCredentials('test-org');
			const updated = all.find((c) => c.id === cred.id);
			expect(updated?.name).toBe('New Name');
			// Value should be decrypted (or plaintext since no master key)
			expect(updated?.value).toBe('new-value');
		});

		it('deletes a credential', async () => {
			const cred = await seedCredential({ name: 'To Delete', envVarKey: 'DEL_KEY', value: 'val' });

			await deleteCredential(cred.id);

			const all = await listOrgCredentials('test-org');
			expect(all.find((c) => c.id === cred.id)).toBeUndefined();
		});

		it('lists all credentials for an org', async () => {
			await seedCredential({ name: 'Cred 1', envVarKey: 'KEY_1', value: 'val1' });
			await seedCredential({ name: 'Cred 2', envVarKey: 'KEY_2', value: 'val2' });
			await seedCredential({ name: 'Cred 3', envVarKey: 'KEY_3', value: 'val3' });

			const all = await listOrgCredentials('test-org');
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
			expect(configsAfter).toHaveLength(0);
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

		it('setIntegrationCredential upserts (delete + insert) correctly', async () => {
			const cred1 = await seedCredential({ name: 'Cred 1', envVarKey: 'KEY', value: 'val1' });
			const cred2 = await seedCredential({ name: 'Cred 2', envVarKey: 'KEY', value: 'val2' });
			const integ = await seedIntegration({ category: 'pm', provider: 'trello' });

			await seedIntegrationCredential({
				integrationId: integ.id,
				role: 'api_key',
				credentialId: cred1.id,
			});

			// Re-set the same role to a different credential
			await setIntegrationCredential(integ.id, 'api_key', cred2.id);

			// Should now point to cred2
			const { resolveIntegrationCredential } = await import(
				'../../../src/db/repositories/credentialsRepository.js'
			);
			const value = await resolveIntegrationCredential('test-project', 'pm', 'api_key');
			expect(value).toBe('val2');
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

	describe('cascade defaults upsert', () => {
		it('creates defaults when none exist', async () => {
			await upsertCascadeDefaults('test-org', {
				model: 'claude-opus-4-5',
				maxIterations: 25,
			});

			const config = await loadConfigFromDb();
			expect(config.defaults.model).toBe('claude-opus-4-5');
			expect(config.defaults.maxIterations).toBe(25);
		});

		it('updates existing defaults', async () => {
			await seedDefaults({ model: 'old-model', maxIterations: 10 });

			await upsertCascadeDefaults('test-org', { model: 'new-model', maxIterations: 20 });

			const config = await loadConfigFromDb();
			expect(config.defaults.model).toBe('new-model');
			expect(config.defaults.maxIterations).toBe(20);
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

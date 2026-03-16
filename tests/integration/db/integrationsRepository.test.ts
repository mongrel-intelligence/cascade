/**
 * Integration tests: integrationsRepository
 *
 * Tests CRUD operations, upsert conflict handling, trigger deep merge,
 * removeIntegrationCredential role mapping, and unique constraint enforcement.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
	listProjectCredentials,
	writeProjectCredential,
} from '../../../src/db/repositories/credentialsRepository.js';
import {
	deleteProjectIntegration,
	getIntegrationByProjectAndCategory,
	listProjectIntegrations,
	removeIntegrationCredential,
	updateProjectIntegrationTriggers,
	upsertProjectIntegration,
} from '../../../src/db/repositories/integrationsRepository.js';
import { truncateAll } from '../helpers/db.js';
import {
	seedCredential,
	seedIntegration,
	seedJiraIntegration,
	seedOrg,
	seedProject,
	seedTrelloIntegration,
} from '../helpers/seed.js';

describe('integrationsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// listProjectIntegrations
	// =========================================================================

	describe('listProjectIntegrations', () => {
		it('returns empty array when project has no integrations', async () => {
			const integrations = await listProjectIntegrations('test-project');
			expect(integrations).toEqual([]);
		});

		it('returns all integrations for a project', async () => {
			await seedIntegration({ projectId: 'test-project', category: 'pm', provider: 'trello' });
			await seedIntegration({ projectId: 'test-project', category: 'scm', provider: 'github' });

			const integrations = await listProjectIntegrations('test-project');
			expect(integrations).toHaveLength(2);
			expect(integrations.map((i) => i.category).sort()).toEqual(['pm', 'scm']);
		});

		it('returns only integrations for the specified project', async () => {
			await seedProject({ id: 'other-project', repo: 'owner/other-repo' });
			await seedIntegration({ projectId: 'test-project', category: 'pm', provider: 'trello' });
			await seedIntegration({ projectId: 'other-project', category: 'pm', provider: 'jira' });

			const integrations = await listProjectIntegrations('test-project');
			expect(integrations).toHaveLength(1);
			expect(integrations[0].projectId).toBe('test-project');
		});
	});

	// =========================================================================
	// getIntegrationByProjectAndCategory
	// =========================================================================

	describe('getIntegrationByProjectAndCategory', () => {
		it('returns null when no integration exists for the category', async () => {
			const result = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect(result).toBeNull();
		});

		it('returns the integration for a matching (projectId, category) pair', async () => {
			await seedIntegration({
				projectId: 'test-project',
				category: 'pm',
				provider: 'trello',
				config: { boardId: 'board-1', lists: {}, labels: {} },
			});

			const result = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect(result).not.toBeNull();
			expect(result?.provider).toBe('trello');
			expect(result?.category).toBe('pm');
			expect(result?.projectId).toBe('test-project');
		});

		it('returns null for a different category on the same project', async () => {
			await seedIntegration({ projectId: 'test-project', category: 'pm', provider: 'trello' });

			const result = await getIntegrationByProjectAndCategory('test-project', 'scm');
			expect(result).toBeNull();
		});

		it('returns null for a different project with the same category', async () => {
			await seedProject({ id: 'other-project', repo: 'owner/other-repo' });
			await seedIntegration({ projectId: 'other-project', category: 'pm', provider: 'jira' });

			const result = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect(result).toBeNull();
		});
	});

	// =========================================================================
	// upsertProjectIntegration — create / update / triggers
	// =========================================================================

	describe('upsertProjectIntegration', () => {
		it('inserts a new integration when none exists', async () => {
			await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-1',
				lists: {},
				labels: {},
			});

			const result = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect(result).not.toBeNull();
			expect(result?.provider).toBe('trello');
			expect((result?.config as Record<string, unknown>)?.boardId).toBe('board-1');
		});

		it('updates provider and config when upserting same (projectId, category)', async () => {
			await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-old',
				lists: {},
				labels: {},
			});

			await upsertProjectIntegration('test-project', 'pm', 'jira', {
				projectKey: 'PROJ',
				baseUrl: 'https://example.atlassian.net',
				statuses: { todo: 'To Do' },
			});

			const result = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect(result?.provider).toBe('jira');
			expect((result?.config as Record<string, unknown>)?.projectKey).toBe('PROJ');
			// Old Trello key should be gone
			expect((result?.config as Record<string, unknown>)?.boardId).toBeUndefined();
		});

		it('preserves existing triggers when triggers parameter is not provided', async () => {
			await upsertProjectIntegration(
				'test-project',
				'pm',
				'trello',
				{ boardId: 'board-1', lists: {}, labels: {} },
				{ cardMovedToTodo: true, cardMovedToPlanning: false },
			);

			// Update config only, no triggers arg
			await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-updated',
				lists: {},
				labels: {},
			});

			const result = await getIntegrationByProjectAndCategory('test-project', 'pm');
			const triggers = result?.triggers as Record<string, boolean>;
			expect(triggers?.cardMovedToTodo).toBe(true);
			expect(triggers?.cardMovedToPlanning).toBe(false);
		});

		it('sets triggers when provided explicitly', async () => {
			await upsertProjectIntegration(
				'test-project',
				'pm',
				'trello',
				{ boardId: 'board-1', lists: {}, labels: {} },
				{ cardMovedToTodo: true },
			);

			const result = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect((result?.triggers as Record<string, boolean>)?.cardMovedToTodo).toBe(true);
		});

		it('returns the upserted row', async () => {
			const row = await upsertProjectIntegration('test-project', 'scm', 'github', {});

			expect(row).not.toBeNull();
			expect(row?.id).toBeTypeOf('number');
			expect(row?.category).toBe('scm');
			expect(row?.provider).toBe('github');
		});
	});

	// =========================================================================
	// deleteProjectIntegration
	// =========================================================================

	describe('deleteProjectIntegration', () => {
		it('removes the integration for the given (projectId, category)', async () => {
			await seedIntegration({ projectId: 'test-project', category: 'pm', provider: 'trello' });
			await seedIntegration({ projectId: 'test-project', category: 'scm', provider: 'github' });

			await deleteProjectIntegration('test-project', 'pm');

			const remaining = await listProjectIntegrations('test-project');
			expect(remaining).toHaveLength(1);
			expect(remaining[0].category).toBe('scm');
		});

		it('is a no-op when no matching integration exists', async () => {
			// Should not throw
			await expect(deleteProjectIntegration('test-project', 'pm')).resolves.not.toThrow();
		});

		it('does not affect integrations for other projects', async () => {
			await seedProject({ id: 'other-project', repo: 'owner/other-repo' });
			await seedIntegration({ projectId: 'test-project', category: 'pm', provider: 'trello' });
			await seedIntegration({ projectId: 'other-project', category: 'pm', provider: 'jira' });

			await deleteProjectIntegration('test-project', 'pm');

			const otherIntegrations = await listProjectIntegrations('other-project');
			expect(otherIntegrations).toHaveLength(1);
		});
	});

	// =========================================================================
	// Full CRUD lifecycle
	// =========================================================================

	describe('full CRUD lifecycle', () => {
		it('creates, retrieves, updates, and deletes an integration', async () => {
			// Create
			await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-1',
				lists: {},
				labels: {},
			});

			// Retrieve
			let integ = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect(integ?.provider).toBe('trello');

			// Update via upsert
			await upsertProjectIntegration('test-project', 'pm', 'jira', {
				projectKey: 'KEY',
				baseUrl: 'https://x.atlassian.net',
				statuses: {},
			});
			integ = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect(integ?.provider).toBe('jira');

			// Ensure list shows 1
			const list = await listProjectIntegrations('test-project');
			expect(list).toHaveLength(1);

			// Delete
			await deleteProjectIntegration('test-project', 'pm');
			integ = await getIntegrationByProjectAndCategory('test-project', 'pm');
			expect(integ).toBeNull();
		});
	});

	// =========================================================================
	// updateProjectIntegrationTriggers — deep merge
	// =========================================================================

	describe('updateProjectIntegrationTriggers', () => {
		it('deep-merges triggers without overwriting untouched keys', async () => {
			await upsertProjectIntegration(
				'test-project',
				'pm',
				'trello',
				{ boardId: 'board-1', lists: {}, labels: {} },
				{ cardMovedToTodo: true, cardMovedToPlanning: true },
			);

			await updateProjectIntegrationTriggers('test-project', 'pm', { cardMovedToTodo: false });

			const result = await getIntegrationByProjectAndCategory('test-project', 'pm');
			const triggers = result?.triggers as Record<string, boolean>;
			expect(triggers?.cardMovedToTodo).toBe(false); // updated
			expect(triggers?.cardMovedToPlanning).toBe(true); // preserved
		});

		it('merges nested trigger objects without overwriting sibling keys', async () => {
			await upsertProjectIntegration(
				'test-project',
				'pm',
				'jira',
				{ projectKey: 'PROJ', baseUrl: 'https://x.atlassian.net', statuses: {} },
				{ issueTransitioned: { splitting: true, planning: true, implementation: true } },
			);

			await updateProjectIntegrationTriggers('test-project', 'pm', {
				issueTransitioned: { implementation: false },
			});

			const result = await getIntegrationByProjectAndCategory('test-project', 'pm');
			const triggers = result?.triggers as Record<string, Record<string, boolean>>;
			expect(triggers?.issueTransitioned?.splitting).toBe(true);
			expect(triggers?.issueTransitioned?.planning).toBe(true);
			expect(triggers?.issueTransitioned?.implementation).toBe(false);
		});

		it('adds new trigger keys that did not previously exist', async () => {
			await upsertProjectIntegration(
				'test-project',
				'pm',
				'trello',
				{ boardId: 'board-1', lists: {}, labels: {} },
				{ existingKey: true },
			);

			await updateProjectIntegrationTriggers('test-project', 'pm', { newKey: false });

			const result = await getIntegrationByProjectAndCategory('test-project', 'pm');
			const triggers = result?.triggers as Record<string, boolean>;
			expect(triggers?.existingKey).toBe(true);
			expect(triggers?.newKey).toBe(false);
		});

		it('throws when integration does not exist', async () => {
			await expect(
				updateProjectIntegrationTriggers('test-project', 'pm', { someKey: true }),
			).rejects.toThrow('No pm integration found for project test-project');
		});
	});

	// =========================================================================
	// removeIntegrationCredential — role-to-envVarKey mapping
	// =========================================================================

	describe('removeIntegrationCredential', () => {
		it('maps api_key role to TRELLO_API_KEY and deletes that credential', async () => {
			const integ = await seedTrelloIntegration('test-project');

			// Verify the credential exists
			const before = await listProjectCredentials('test-project');
			expect(before.find((c) => c.envVarKey === 'TRELLO_API_KEY')).toBeDefined();

			await removeIntegrationCredential(integ.id, 'api_key');

			const after = await listProjectCredentials('test-project');
			expect(after.find((c) => c.envVarKey === 'TRELLO_API_KEY')).toBeUndefined();
		});

		it('maps token role to TRELLO_TOKEN and deletes that credential', async () => {
			const integ = await seedTrelloIntegration('test-project');

			await removeIntegrationCredential(integ.id, 'token');

			const after = await listProjectCredentials('test-project');
			expect(after.find((c) => c.envVarKey === 'TRELLO_TOKEN')).toBeUndefined();
			// Other credentials should remain
			expect(after.find((c) => c.envVarKey === 'TRELLO_API_KEY')).toBeDefined();
		});

		it('maps email role to JIRA_EMAIL and deletes that credential', async () => {
			const integ = await seedJiraIntegration('test-project');

			await removeIntegrationCredential(integ.id, 'email');

			const after = await listProjectCredentials('test-project');
			expect(after.find((c) => c.envVarKey === 'JIRA_EMAIL')).toBeUndefined();
			expect(after.find((c) => c.envVarKey === 'JIRA_API_TOKEN')).toBeDefined();
		});

		it('maps api_token role to JIRA_API_TOKEN and deletes that credential', async () => {
			const integ = await seedJiraIntegration('test-project');

			await removeIntegrationCredential(integ.id, 'api_token');

			const after = await listProjectCredentials('test-project');
			expect(after.find((c) => c.envVarKey === 'JIRA_API_TOKEN')).toBeUndefined();
			expect(after.find((c) => c.envVarKey === 'JIRA_EMAIL')).toBeDefined();
		});

		it('maps implementer_token role to GITHUB_TOKEN_IMPLEMENTER and deletes that credential', async () => {
			const integ = await seedIntegration({
				projectId: 'test-project',
				category: 'scm',
				provider: 'github',
			});
			await writeProjectCredential(
				'test-project',
				'GITHUB_TOKEN_IMPLEMENTER',
				'ghp-impl',
				'Implementer',
			);
			await writeProjectCredential('test-project', 'GITHUB_TOKEN_REVIEWER', 'ghp-rev', 'Reviewer');

			await removeIntegrationCredential(integ.id, 'implementer_token');

			const after = await listProjectCredentials('test-project');
			expect(after.find((c) => c.envVarKey === 'GITHUB_TOKEN_IMPLEMENTER')).toBeUndefined();
			expect(after.find((c) => c.envVarKey === 'GITHUB_TOKEN_REVIEWER')).toBeDefined();
		});

		it('is a no-op for an unknown role (no matching envVarKey)', async () => {
			const integ = await seedTrelloIntegration('test-project');
			const before = await listProjectCredentials('test-project');

			// 'unknown_role' has no mapping in PROVIDER_CREDENTIAL_ROLES
			await removeIntegrationCredential(integ.id, 'unknown_role');

			const after = await listProjectCredentials('test-project');
			expect(after).toHaveLength(before.length);
		});

		it('is a no-op when the integration id does not exist', async () => {
			await seedCredential({
				projectId: 'test-project',
				envVarKey: 'TRELLO_API_KEY',
				value: 'test-val',
			});

			// Non-existent integration ID — should not throw or delete anything
			await removeIntegrationCredential(999999, 'api_key');

			const after = await listProjectCredentials('test-project');
			expect(after.find((c) => c.envVarKey === 'TRELLO_API_KEY')).toBeDefined();
		});
	});

	// =========================================================================
	// JSONB config round-trip
	// =========================================================================

	describe('JSONB config round-trip', () => {
		it('persists and reads back a Trello config with nested objects', async () => {
			const trelloConfig = {
				boardId: 'board-xyz',
				lists: {
					todo: 'list-todo-id',
					splitting: 'list-split-id',
					planning: 'list-plan-id',
					implementation: 'list-impl-id',
					done: 'list-done-id',
				},
				labels: {
					bug: 'label-bug-id',
					feature: 'label-feat-id',
				},
			};

			await upsertProjectIntegration('test-project', 'pm', 'trello', trelloConfig);

			const result = await getIntegrationByProjectAndCategory('test-project', 'pm');
			const config = result?.config as typeof trelloConfig;
			expect(config.boardId).toBe('board-xyz');
			expect(config.lists.todo).toBe('list-todo-id');
			expect(config.lists.implementation).toBe('list-impl-id');
			expect(config.labels.bug).toBe('label-bug-id');
		});

		it('persists and reads back a JIRA config correctly', async () => {
			const jiraConfig = {
				projectKey: 'MYPROJ',
				baseUrl: 'https://myteam.atlassian.net',
				statuses: {
					todo: 'To Do',
					inProgress: 'In Progress',
					done: 'Done',
					splitting: 'Backlog',
				},
			};

			await upsertProjectIntegration('test-project', 'pm', 'jira', jiraConfig);

			const result = await getIntegrationByProjectAndCategory('test-project', 'pm');
			const config = result?.config as typeof jiraConfig;
			expect(config.projectKey).toBe('MYPROJ');
			expect(config.baseUrl).toBe('https://myteam.atlassian.net');
			expect(config.statuses.todo).toBe('To Do');
			expect(config.statuses.inProgress).toBe('In Progress');
		});
	});

	// =========================================================================
	// Unique constraint: one PM and one SCM per project
	// =========================================================================

	describe('unique constraint: one PM and one SCM per project', () => {
		it('only one PM integration exists per project (upsert resolves conflict)', async () => {
			await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-1',
				lists: {},
				labels: {},
			});
			await upsertProjectIntegration('test-project', 'pm', 'jira', {
				projectKey: 'PROJ',
				baseUrl: 'https://x.atlassian.net',
				statuses: {},
			});

			const integrations = await listProjectIntegrations('test-project');
			const pmIntegrations = integrations.filter((i) => i.category === 'pm');
			expect(pmIntegrations).toHaveLength(1);
			expect(pmIntegrations[0].provider).toBe('jira'); // most recent wins
		});

		it('only one SCM integration exists per project (upsert resolves conflict)', async () => {
			await upsertProjectIntegration('test-project', 'scm', 'github', { installationId: '111' });
			await upsertProjectIntegration('test-project', 'scm', 'github', { installationId: '222' });

			const integrations = await listProjectIntegrations('test-project');
			const scmIntegrations = integrations.filter((i) => i.category === 'scm');
			expect(scmIntegrations).toHaveLength(1);
			expect((scmIntegrations[0].config as Record<string, unknown>)?.installationId).toBe('222');
		});

		it('allows one PM and one SCM integration on the same project simultaneously', async () => {
			await upsertProjectIntegration('test-project', 'pm', 'trello', {
				boardId: 'board-1',
				lists: {},
				labels: {},
			});
			await upsertProjectIntegration('test-project', 'scm', 'github', {});

			const integrations = await listProjectIntegrations('test-project');
			expect(integrations).toHaveLength(2);
			expect(integrations.map((i) => i.category).sort()).toEqual(['pm', 'scm']);
		});

		it('different projects can each have their own PM integration independently', async () => {
			await seedProject({ id: 'proj-a', repo: 'owner/repo-a' });
			await seedProject({ id: 'proj-b', repo: 'owner/repo-b' });

			await upsertProjectIntegration('proj-a', 'pm', 'trello', {
				boardId: 'board-a',
				lists: {},
				labels: {},
			});
			await upsertProjectIntegration('proj-b', 'pm', 'jira', {
				projectKey: 'B',
				baseUrl: 'https://b.atlassian.net',
				statuses: {},
			});

			const projAInteg = await getIntegrationByProjectAndCategory('proj-a', 'pm');
			const projBInteg = await getIntegrationByProjectAndCategory('proj-b', 'pm');

			expect(projAInteg?.provider).toBe('trello');
			expect(projBInteg?.provider).toBe('jira');
		});
	});
});

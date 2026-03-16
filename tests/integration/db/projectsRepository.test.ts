/**
 * Integration tests: projectsRepository
 *
 * Tests full CRUD, org scoping, engine settings normalization, optional field
 * persistence, and cross-org listing against a real PostgreSQL database.
 *
 * Coverage note: repositories-edge-cases.test.ts covers basic CRUD via the
 * settingsRepository wrappers. This suite tests the direct projectsRepository
 * functions with deeper coverage of normalization, scoping, and nullable fields.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
	createProject,
	deleteProject,
	getProjectFull,
	listAllProjects,
	listProjectsFull,
	updateProject,
} from '../../../src/db/repositories/projectsRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject } from '../helpers/seed.js';

describe('projectsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// createProject
	// =========================================================================

	describe('createProject', () => {
		it('creates a project with required fields and sensible defaults', async () => {
			const project = await createProject('test-org', {
				id: 'new-project',
				name: 'New Project',
				repo: 'owner/new-repo',
				baseBranch: 'main',
			});

			expect(project).toBeDefined();
			expect(project.id).toBe('new-project');
			expect(project.orgId).toBe('test-org');
			expect(project.name).toBe('New Project');
			expect(project.repo).toBe('owner/new-repo');
			expect(project.baseBranch).toBe('main');
			expect(project.branchPrefix).toBe('feature/');
			expect(project.runLinksEnabled).toBe(false);
		});

		it('creates a project with all optional fields set', async () => {
			const project = await createProject('test-org', {
				id: 'full-project',
				name: 'Full Project',
				repo: 'owner/full-repo',
				baseBranch: 'develop',
				branchPrefix: 'fix/',
				model: 'claude-opus-4-5',
				maxIterations: 30,
				watchdogTimeoutMs: 120000,
				workItemBudgetUsd: '25.00',
				agentEngine: 'claude-code',
				engineSettings: { 'claude-code': { maxTokens: 4096 } },
				progressModel: 'claude-haiku',
				progressIntervalMinutes: '5',
				runLinksEnabled: true,
				maxInFlightItems: 3,
			});

			expect(project.baseBranch).toBe('develop');
			expect(project.branchPrefix).toBe('fix/');
			expect(project.model).toBe('claude-opus-4-5');
			expect(project.maxIterations).toBe(30);
			expect(project.watchdogTimeoutMs).toBe(120000);
			expect(project.workItemBudgetUsd).toBe('25.00');
			expect(project.agentEngine).toBe('claude-code');
			expect(project.progressModel).toBe('claude-haiku');
			// progressIntervalMinutes is numeric(5,1) — DB returns '5.0' for input '5'
			expect(project.progressIntervalMinutes).toBe('5.0');
			expect(project.runLinksEnabled).toBe(true);
			expect(project.maxInFlightItems).toBe(3);
		});

		it('persists null for all nullable optional fields when unset', async () => {
			const project = await createProject('test-org', {
				id: 'nullable-project',
				name: 'Nullable Project',
				model: null,
				maxIterations: null,
				watchdogTimeoutMs: null,
				workItemBudgetUsd: null,
				agentEngine: null,
				engineSettings: null,
				progressModel: null,
				progressIntervalMinutes: null,
				maxInFlightItems: null,
			});

			expect(project.model).toBeNull();
			expect(project.maxIterations).toBeNull();
			expect(project.watchdogTimeoutMs).toBeNull();
			expect(project.workItemBudgetUsd).toBeNull();
			expect(project.agentEngine).toBeNull();
			expect(project.agentEngineSettings).toBeNull();
			expect(project.progressModel).toBeNull();
			expect(project.progressIntervalMinutes).toBeNull();
			expect(project.maxInFlightItems).toBeNull();
		});

		it('normalizes engineSettings on create — strips empty sub-objects', async () => {
			// An engine entry with no keys should be collapsed away
			const project = await createProject('test-org', {
				id: 'normalize-project',
				name: 'Normalize Project',
				engineSettings: { 'claude-code': {} },
			});

			// normalizeEngineSettings collapses empty engine objects to undefined
			expect(project.agentEngineSettings).toBeNull();
		});

		it('normalizes engineSettings on create — strips undefined values', async () => {
			const project = await createProject('test-org', {
				id: 'normalize-project-2',
				name: 'Normalize Project 2',
				engineSettings: { 'claude-code': { maxTokens: 4096, skippedKey: undefined } },
			});

			// Only defined values are preserved; undefined entries are stripped
			expect(project.agentEngineSettings).toEqual({ 'claude-code': { maxTokens: 4096 } });
		});

		it('sets default baseBranch to main when not provided', async () => {
			const project = await createProject('test-org', {
				id: 'default-branch-project',
				name: 'Default Branch Project',
			});

			expect(project.baseBranch).toBe('main');
		});
	});

	// =========================================================================
	// listProjectsFull
	// =========================================================================

	describe('listProjectsFull', () => {
		it('returns only projects belonging to the given org', async () => {
			await seedOrg('other-org', 'Other Org');
			await seedProject({ id: 'other-project', orgId: 'other-org', repo: 'other/repo' });

			const projects = await listProjectsFull('test-org');

			expect(projects).toHaveLength(1);
			expect(projects[0].id).toBe('test-project');
			expect(projects.every((p) => p.orgId === 'test-org')).toBe(true);
		});

		it('returns all projects for an org when multiple exist', async () => {
			await seedProject({ id: 'project-2', name: 'Project 2', repo: 'owner/repo2' });
			await seedProject({ id: 'project-3', name: 'Project 3', repo: 'owner/repo3' });

			const projects = await listProjectsFull('test-org');

			expect(projects).toHaveLength(3);
			const ids = projects.map((p) => p.id).sort();
			expect(ids).toEqual(['project-2', 'project-3', 'test-project']);
		});

		it('returns empty array for an org with no projects', async () => {
			await seedOrg('empty-org', 'Empty Org');

			const projects = await listProjectsFull('empty-org');

			expect(projects).toHaveLength(0);
		});

		it('returns empty array after all projects are deleted', async () => {
			await deleteProject('test-project', 'test-org');

			const projects = await listProjectsFull('test-org');

			expect(projects).toHaveLength(0);
		});
	});

	// =========================================================================
	// listAllProjects
	// =========================================================================

	describe('listAllProjects', () => {
		it('returns projects across multiple orgs', async () => {
			await seedOrg('org-2', 'Org 2');
			await seedProject({ id: 'proj-org2', orgId: 'org-2', repo: 'org2/repo' });

			const projects = await listAllProjects();

			expect(projects.length).toBeGreaterThanOrEqual(2);
			const ids = projects.map((p) => p.id);
			expect(ids).toContain('test-project');
			expect(ids).toContain('proj-org2');
		});

		it('returns all projects including those from different orgs', async () => {
			await seedOrg('org-a', 'Org A');
			await seedOrg('org-b', 'Org B');
			await seedProject({ id: 'proj-a', orgId: 'org-a', repo: 'org-a/repo' });
			await seedProject({ id: 'proj-b', orgId: 'org-b', repo: 'org-b/repo' });

			const projects = await listAllProjects();

			const orgIds = projects.map((p) => p.orgId);
			expect(orgIds).toContain('test-org');
			expect(orgIds).toContain('org-a');
			expect(orgIds).toContain('org-b');
		});

		it('does not filter by org — unlike listProjectsFull', async () => {
			await seedOrg('other-org', 'Other Org');
			await seedProject({ id: 'other-project', orgId: 'other-org', repo: 'other/repo' });

			const allProjects = await listAllProjects();
			const scopedProjects = await listProjectsFull('test-org');

			expect(allProjects.length).toBeGreaterThan(scopedProjects.length);
		});
	});

	// =========================================================================
	// getProjectFull
	// =========================================================================

	describe('getProjectFull', () => {
		it('returns the project when the projectId and orgId match', async () => {
			const project = await getProjectFull('test-project', 'test-org');

			expect(project).toBeDefined();
			expect(project?.id).toBe('test-project');
			expect(project?.orgId).toBe('test-org');
			expect(project?.repo).toBe('owner/repo');
		});

		it('returns null for wrong orgId (org scoping enforced)', async () => {
			const project = await getProjectFull('test-project', 'wrong-org');

			expect(project).toBeNull();
		});

		it('returns null for non-existent projectId', async () => {
			const project = await getProjectFull('nonexistent-project', 'test-org');

			expect(project).toBeNull();
		});

		it('returns null when both projectId and orgId are wrong', async () => {
			const project = await getProjectFull('nonexistent', 'wrong-org');

			expect(project).toBeNull();
		});

		it('returns null when project ID does not exist for the org', async () => {
			await seedOrg('org-2', 'Org 2');
			await createProject('org-2', {
				id: 'org2-only-project',
				name: 'Org 2 Only Project',
				repo: 'org2/only-repo',
			});

			// org-2's project should not be visible when querying with test-org
			const project = await getProjectFull('org2-only-project', 'test-org');

			expect(project).toBeNull();
		});
	});

	// =========================================================================
	// updateProject
	// =========================================================================

	describe('updateProject', () => {
		it('updates basic fields', async () => {
			await updateProject('test-project', 'test-org', {
				name: 'Updated Name',
				repo: 'updated/repo',
				baseBranch: 'develop',
			});

			const project = await getProjectFull('test-project', 'test-org');
			expect(project?.name).toBe('Updated Name');
			expect(project?.repo).toBe('updated/repo');
			expect(project?.baseBranch).toBe('develop');
		});

		it('performs partial update without affecting other fields', async () => {
			await updateProject('test-project', 'test-org', {
				model: 'claude-opus-4-5',
				maxIterations: 25,
			});

			const project = await getProjectFull('test-project', 'test-org');
			// Updated fields
			expect(project?.model).toBe('claude-opus-4-5');
			expect(project?.maxIterations).toBe(25);
			// Fields not touched
			expect(project?.repo).toBe('owner/repo');
			expect(project?.baseBranch).toBe('main');
		});

		it('updates nullable fields to null', async () => {
			// First set values
			await updateProject('test-project', 'test-org', {
				model: 'claude-opus-4-5',
				maxIterations: 20,
				watchdogTimeoutMs: 60000,
				workItemBudgetUsd: '10.00',
				agentEngine: 'claude-code',
				progressModel: 'claude-haiku',
				maxInFlightItems: 5,
			});

			// Then clear them
			await updateProject('test-project', 'test-org', {
				model: null,
				maxIterations: null,
				watchdogTimeoutMs: null,
				workItemBudgetUsd: null,
				agentEngine: null,
				progressModel: null,
				maxInFlightItems: null,
			});

			const project = await getProjectFull('test-project', 'test-org');
			expect(project?.model).toBeNull();
			expect(project?.maxIterations).toBeNull();
			expect(project?.watchdogTimeoutMs).toBeNull();
			expect(project?.workItemBudgetUsd).toBeNull();
			expect(project?.agentEngine).toBeNull();
			expect(project?.progressModel).toBeNull();
			expect(project?.maxInFlightItems).toBeNull();
		});

		it('enforces orgId scoping — does not update project in a different org', async () => {
			await updateProject('test-project', 'wrong-org', {
				name: 'Should Not Update',
			});

			// Project should be unchanged under the real org
			const project = await getProjectFull('test-project', 'test-org');
			expect(project?.name).toBe('Test Project');
		});

		it('normalizes engineSettings on update — empty sub-object normalizes to undefined (no-op)', async () => {
			// Set real engine settings first
			await updateProject('test-project', 'test-org', {
				engineSettings: { 'claude-code': { maxTokens: 4096 } },
			});

			// normalizeEngineSettings({ 'claude-code': {} }) returns undefined,
			// which Drizzle treats as "don't set the column" — so the column is unchanged.
			await updateProject('test-project', 'test-org', {
				engineSettings: { 'claude-code': {} },
			});

			const project = await getProjectFull('test-project', 'test-org');
			// Column unchanged because normalized value was undefined (Drizzle skips undefined SET values)
			expect(project?.agentEngineSettings).toEqual({ 'claude-code': { maxTokens: 4096 } });
		});

		it('normalizes engineSettings on update — preserves valid keys', async () => {
			await updateProject('test-project', 'test-org', {
				engineSettings: { 'claude-code': { maxTokens: 8192, topP: 0.9 } },
			});

			const project = await getProjectFull('test-project', 'test-org');
			expect(project?.agentEngineSettings).toEqual({
				'claude-code': { maxTokens: 8192, topP: 0.9 },
			});
		});

		it('can update engineSettings to null', async () => {
			await updateProject('test-project', 'test-org', {
				engineSettings: { 'claude-code': { maxTokens: 4096 } },
			});

			await updateProject('test-project', 'test-org', {
				engineSettings: null,
			});

			const project = await getProjectFull('test-project', 'test-org');
			expect(project?.agentEngineSettings).toBeNull();
		});

		it('does not modify engineSettings when the key is absent from updates', async () => {
			// Set initial engine settings
			await updateProject('test-project', 'test-org', {
				engineSettings: { 'claude-code': { maxTokens: 4096 } },
			});

			// Update something else without touching engineSettings
			await updateProject('test-project', 'test-org', {
				name: 'Name Only Update',
			});

			const project = await getProjectFull('test-project', 'test-org');
			expect(project?.agentEngineSettings).toEqual({ 'claude-code': { maxTokens: 4096 } });
			expect(project?.name).toBe('Name Only Update');
		});
	});

	// =========================================================================
	// deleteProject
	// =========================================================================

	describe('deleteProject', () => {
		it('removes the project', async () => {
			await deleteProject('test-project', 'test-org');

			const project = await getProjectFull('test-project', 'test-org');
			expect(project).toBeNull();
		});

		it('enforces orgId scoping — wrong orgId is a no-op', async () => {
			await deleteProject('test-project', 'wrong-org');

			// Project should still exist
			const project = await getProjectFull('test-project', 'test-org');
			expect(project).toBeDefined();
			expect(project?.id).toBe('test-project');
		});

		it('is idempotent — deleting non-existent project does not throw', async () => {
			await expect(deleteProject('nonexistent-project', 'test-org')).resolves.not.toThrow();
		});

		it('removes only the targeted project when multiple exist', async () => {
			await seedProject({ id: 'project-2', name: 'Project 2', repo: 'owner/repo2' });

			await deleteProject('test-project', 'test-org');

			const remaining = await listProjectsFull('test-org');
			expect(remaining).toHaveLength(1);
			expect(remaining[0].id).toBe('project-2');
		});
	});

	// =========================================================================
	// Engine settings normalization (create + update)
	// =========================================================================

	describe('engine settings normalization', () => {
		it('stores and retrieves complex engineSettings round-trip via createProject', async () => {
			const engineSettings = {
				'claude-code': { maxTokens: 4096, temperature: 0.7 },
			};

			const project = await createProject('test-org', {
				id: 'es-round-trip',
				name: 'ES Round Trip',
				engineSettings,
			});

			expect(project.agentEngineSettings).toEqual(engineSettings);
		});

		it('round-trips engineSettings through updateProject', async () => {
			const engineSettings = {
				'claude-code': { maxTokens: 8192, topP: 0.9 },
			};

			await updateProject('test-project', 'test-org', { engineSettings });

			const project = await getProjectFull('test-project', 'test-org');
			expect(project?.agentEngineSettings).toEqual(engineSettings);
		});

		it('normalizeEngineSettings strips all entries when all sub-objects are empty', async () => {
			const project = await createProject('test-org', {
				id: 'es-all-empty',
				name: 'ES All Empty',
				engineSettings: {
					'claude-code': {},
					codex: {},
				},
			});

			// All sub-objects empty — should collapse to undefined (stored as null)
			expect(project.agentEngineSettings).toBeNull();
		});

		it('normalizeEngineSettings strips only empty engine entries, preserves non-empty ones', async () => {
			const project = await createProject('test-org', {
				id: 'es-partial-empty',
				name: 'ES Partial Empty',
				engineSettings: {
					'claude-code': { maxTokens: 4096 },
					codex: {},
				},
			});

			// codex entry is empty and should be stripped
			expect(project.agentEngineSettings).toEqual({ 'claude-code': { maxTokens: 4096 } });
		});
	});

	// =========================================================================
	// Optional fields round-trip
	// =========================================================================

	describe('optional fields round-trip', () => {
		it('all nullable fields read back correctly when set', async () => {
			const project = await createProject('test-org', {
				id: 'all-fields-project',
				name: 'All Fields Project',
				repo: 'owner/all-fields',
				baseBranch: 'main',
				branchPrefix: 'feat/',
				model: 'claude-sonnet',
				maxIterations: 20,
				watchdogTimeoutMs: 90000,
				workItemBudgetUsd: '50.00',
				agentEngine: 'claude-code',
				engineSettings: { 'claude-code': { maxTokens: 2048 } },
				progressModel: 'claude-haiku',
				progressIntervalMinutes: '3',
				runLinksEnabled: true,
				maxInFlightItems: 2,
			});

			const retrieved = await getProjectFull('all-fields-project', 'test-org');

			expect(retrieved?.model).toBe('claude-sonnet');
			expect(retrieved?.maxIterations).toBe(20);
			expect(retrieved?.watchdogTimeoutMs).toBe(90000);
			expect(retrieved?.workItemBudgetUsd).toBe('50.00');
			expect(retrieved?.agentEngine).toBe('claude-code');
			expect(retrieved?.agentEngineSettings).toEqual({ 'claude-code': { maxTokens: 2048 } });
			expect(retrieved?.progressModel).toBe('claude-haiku');
			// progressIntervalMinutes is numeric(5,1) — DB returns '3.0' for input '3'
			expect(retrieved?.progressIntervalMinutes).toBe('3.0');
			expect(retrieved?.runLinksEnabled).toBe(true);
			expect(retrieved?.maxInFlightItems).toBe(2);
		});

		it('all nullable fields read back as null when not set', async () => {
			// seedProject creates a minimal project — check defaults
			const project = await getProjectFull('test-project', 'test-org');

			expect(project?.model).toBeNull();
			expect(project?.maxIterations).toBeNull();
			expect(project?.watchdogTimeoutMs).toBeNull();
			expect(project?.workItemBudgetUsd).toBeNull();
			expect(project?.agentEngine).toBeNull();
			expect(project?.agentEngineSettings).toBeNull();
			expect(project?.progressModel).toBeNull();
			expect(project?.progressIntervalMinutes).toBeNull();
			expect(project?.maxInFlightItems).toBeNull();
		});
	});

	// =========================================================================
	// Multi-org isolation
	// =========================================================================

	describe('multi-org isolation', () => {
		it('listProjectsFull only returns projects for the requested org', async () => {
			await seedOrg('org-a', 'Org A');
			await seedOrg('org-b', 'Org B');
			await seedProject({ id: 'proj-a-1', orgId: 'org-a', repo: 'org-a/repo1' });
			await seedProject({ id: 'proj-a-2', orgId: 'org-a', repo: 'org-a/repo2' });
			await seedProject({ id: 'proj-b-1', orgId: 'org-b', repo: 'org-b/repo1' });

			const orgAProjects = await listProjectsFull('org-a');
			const orgBProjects = await listProjectsFull('org-b');

			expect(orgAProjects).toHaveLength(2);
			expect(orgAProjects.every((p) => p.orgId === 'org-a')).toBe(true);

			expect(orgBProjects).toHaveLength(1);
			expect(orgBProjects[0].orgId).toBe('org-b');
		});

		it('listAllProjects returns projects from all orgs', async () => {
			await seedOrg('org-x', 'Org X');
			await seedProject({ id: 'proj-x', orgId: 'org-x', repo: 'org-x/repo' });

			const all = await listAllProjects();
			const allOrgIds = all.map((p) => p.orgId);

			expect(allOrgIds).toContain('test-org');
			expect(allOrgIds).toContain('org-x');
		});

		it('getProjectFull returns null for a project in a different org', async () => {
			await seedOrg('org-2', 'Org 2');
			await createProject('org-2', {
				id: 'org2-exclusive-proj',
				name: 'Org 2 Proj',
				repo: 'org2/repo',
			});

			// test-org cannot see org-2's project
			const fromTestOrg = await getProjectFull('org2-exclusive-proj', 'test-org');
			expect(fromTestOrg).toBeNull();

			// org-2 can see its own project
			const fromOrg2 = await getProjectFull('org2-exclusive-proj', 'org-2');
			expect(fromOrg2?.name).toBe('Org 2 Proj');
		});
	});
});

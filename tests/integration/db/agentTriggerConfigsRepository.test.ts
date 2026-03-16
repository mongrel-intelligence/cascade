import { beforeEach, describe, expect, it } from 'vitest';
import {
	bulkUpsertTriggerConfigs,
	deleteTriggerConfig,
	deleteTriggerConfigsByProject,
	getTriggerConfig,
	getTriggerConfigById,
	getTriggerConfigsByProject,
	getTriggerConfigsByProjectAndAgent,
	updateTriggerConfig,
	upsertTriggerConfig,
} from '../../../src/db/repositories/agentTriggerConfigsRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject, seedTriggerConfig } from '../helpers/seed.js';

describe('agentTriggerConfigsRepository (integration)', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();
	});

	// =========================================================================
	// upsertTriggerConfig — create
	// =========================================================================

	describe('upsertTriggerConfig (create)', () => {
		it('creates a new trigger config and returns it', async () => {
			const config = await upsertTriggerConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
				parameters: {},
			});

			expect(config.id).toBeDefined();
			expect(typeof config.id).toBe('number');
			expect(config.projectId).toBe('test-project');
			expect(config.agentType).toBe('implementation');
			expect(config.triggerEvent).toBe('pm:status-changed');
			expect(config.enabled).toBe(true);
			expect(config.parameters).toEqual({});
		});

		it('defaults enabled to true when not provided', async () => {
			const config = await upsertTriggerConfig({
				projectId: 'test-project',
				agentType: 'review',
				triggerEvent: 'scm:check-suite-success',
			});

			expect(config.enabled).toBe(true);
		});

		it('defaults parameters to empty object when not provided', async () => {
			const config = await upsertTriggerConfig({
				projectId: 'test-project',
				agentType: 'review',
				triggerEvent: 'scm:pr-opened',
			});

			expect(config.parameters).toEqual({});
		});
	});

	// =========================================================================
	// getTriggerConfig — read by composite key
	// =========================================================================

	describe('getTriggerConfig', () => {
		it('retrieves a config by composite key (projectId, agentType, triggerEvent)', async () => {
			await seedTriggerConfig({
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
			});

			const config = await getTriggerConfig('test-project', 'implementation', 'pm:status-changed');

			expect(config).not.toBeNull();
			expect(config?.projectId).toBe('test-project');
			expect(config?.agentType).toBe('implementation');
			expect(config?.triggerEvent).toBe('pm:status-changed');
		});

		it('returns null when no matching config exists', async () => {
			const config = await getTriggerConfig('test-project', 'review', 'scm:pr-opened');
			expect(config).toBeNull();
		});

		it('returns null when projectId does not match', async () => {
			await seedTriggerConfig({
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
			});

			const config = await getTriggerConfig('other-project', 'implementation', 'pm:status-changed');
			expect(config).toBeNull();
		});
	});

	// =========================================================================
	// getTriggerConfigById — read by primary key
	// =========================================================================

	describe('getTriggerConfigById', () => {
		it('retrieves a config by primary key ID', async () => {
			const seeded = await seedTriggerConfig({
				agentType: 'planning',
				triggerEvent: 'pm:label-added',
				enabled: false,
			});

			const config = await getTriggerConfigById(seeded.id);

			expect(config).not.toBeNull();
			expect(config?.id).toBe(seeded.id);
			expect(config?.agentType).toBe('planning');
			expect(config?.triggerEvent).toBe('pm:label-added');
			expect(config?.enabled).toBe(false);
		});

		it('returns null for a non-existent ID', async () => {
			const config = await getTriggerConfigById(999999);
			expect(config).toBeNull();
		});
	});

	// =========================================================================
	// updateTriggerConfig — partial update
	// =========================================================================

	describe('updateTriggerConfig', () => {
		it('updates the enabled field by ID', async () => {
			const seeded = await seedTriggerConfig({
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
			});

			const updated = await updateTriggerConfig(seeded.id, { enabled: false });

			expect(updated).not.toBeNull();
			expect(updated?.enabled).toBe(false);
			expect(updated?.agentType).toBe('implementation');
		});

		it('updates the parameters field by ID', async () => {
			const seeded = await seedTriggerConfig({
				agentType: 'review',
				triggerEvent: 'scm:check-suite-success',
				parameters: { authorMode: 'own' },
			});

			const updated = await updateTriggerConfig(seeded.id, {
				parameters: { authorMode: 'external' },
			});

			expect(updated?.parameters).toEqual({ authorMode: 'external' });
		});

		it('updates updatedAt timestamp', async () => {
			const seeded = await seedTriggerConfig({
				agentType: 'implementation',
				triggerEvent: 'pm:label-added',
			});

			const originalUpdatedAt = seeded.updatedAt;

			// Small delay to ensure timestamp differs
			await new Promise((r) => setTimeout(r, 5));
			const updated = await updateTriggerConfig(seeded.id, { enabled: false });

			// updatedAt should be set (and different from null if previously null)
			expect(updated?.updatedAt).toBeDefined();
			if (originalUpdatedAt) {
				expect(updated?.updatedAt?.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
			}
		});

		it('returns null when the ID does not exist', async () => {
			const result = await updateTriggerConfig(999999, { enabled: false });
			expect(result).toBeNull();
		});
	});

	// =========================================================================
	// deleteTriggerConfig — delete by ID
	// =========================================================================

	describe('deleteTriggerConfig', () => {
		it('deletes a trigger config by ID and returns true', async () => {
			const seeded = await seedTriggerConfig({
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
			});

			const result = await deleteTriggerConfig(seeded.id);

			expect(result).toBe(true);

			// Verify it's gone
			const fetched = await getTriggerConfigById(seeded.id);
			expect(fetched).toBeNull();
		});

		it('returns false when the ID does not exist', async () => {
			const result = await deleteTriggerConfig(999999);
			expect(result).toBe(false);
		});
	});

	// =========================================================================
	// Upsert conflict resolution
	// =========================================================================

	describe('upsertTriggerConfig (conflict resolution)', () => {
		it('updates an existing config instead of inserting a duplicate on conflict', async () => {
			const first = await upsertTriggerConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
				parameters: { threshold: 0.5 },
			});

			const second = await upsertTriggerConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: false,
				parameters: { threshold: 0.9 },
			});

			// Same ID — no duplicate row
			expect(second.id).toBe(first.id);
			expect(second.enabled).toBe(false);
			expect(second.parameters).toEqual({ threshold: 0.9 });

			// Only one row exists for this composite key
			const all = await getTriggerConfigsByProject('test-project');
			expect(all).toHaveLength(1);
		});

		it('does not update other configs when upserting a specific key', async () => {
			await upsertTriggerConfig({
				projectId: 'test-project',
				agentType: 'review',
				triggerEvent: 'scm:pr-opened',
				enabled: true,
			});
			await upsertTriggerConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
			});

			// Upsert only one
			await upsertTriggerConfig({
				projectId: 'test-project',
				agentType: 'review',
				triggerEvent: 'scm:pr-opened',
				enabled: false,
			});

			const reviewConfig = await getTriggerConfig('test-project', 'review', 'scm:pr-opened');
			const implConfig = await getTriggerConfig(
				'test-project',
				'implementation',
				'pm:status-changed',
			);

			expect(reviewConfig?.enabled).toBe(false);
			expect(implConfig?.enabled).toBe(true); // untouched
		});
	});

	// =========================================================================
	// getTriggerConfigsByProject
	// =========================================================================

	describe('getTriggerConfigsByProject', () => {
		it('returns all configs for a project', async () => {
			await seedTriggerConfig({ agentType: 'implementation', triggerEvent: 'pm:status-changed' });
			await seedTriggerConfig({ agentType: 'review', triggerEvent: 'scm:pr-opened' });
			await seedTriggerConfig({ agentType: 'planning', triggerEvent: 'pm:label-added' });

			const configs = await getTriggerConfigsByProject('test-project');
			expect(configs).toHaveLength(3);
			expect(configs.every((c) => c.projectId === 'test-project')).toBe(true);
		});

		it('returns empty array when project has no configs', async () => {
			const configs = await getTriggerConfigsByProject('test-project');
			expect(configs).toEqual([]);
		});
	});

	// =========================================================================
	// getTriggerConfigsByProjectAndAgent
	// =========================================================================

	describe('getTriggerConfigsByProjectAndAgent', () => {
		it('returns configs filtered by project and agent type', async () => {
			await seedTriggerConfig({ agentType: 'review', triggerEvent: 'scm:pr-opened' });
			await seedTriggerConfig({ agentType: 'review', triggerEvent: 'scm:check-suite-success' });
			await seedTriggerConfig({
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
			});

			const reviewConfigs = await getTriggerConfigsByProjectAndAgent('test-project', 'review');
			expect(reviewConfigs).toHaveLength(2);
			expect(reviewConfigs.every((c) => c.agentType === 'review')).toBe(true);
		});

		it('returns empty array for an agent with no configs', async () => {
			await seedTriggerConfig({ agentType: 'review', triggerEvent: 'scm:pr-opened' });

			const configs = await getTriggerConfigsByProjectAndAgent('test-project', 'planning');
			expect(configs).toEqual([]);
		});
	});

	// =========================================================================
	// deleteTriggerConfigsByProject — bulk delete
	// =========================================================================

	describe('deleteTriggerConfigsByProject', () => {
		it('deletes all configs for a project and returns the count', async () => {
			await seedTriggerConfig({ agentType: 'implementation', triggerEvent: 'pm:status-changed' });
			await seedTriggerConfig({ agentType: 'review', triggerEvent: 'scm:pr-opened' });
			await seedTriggerConfig({ agentType: 'planning', triggerEvent: 'pm:label-added' });

			const count = await deleteTriggerConfigsByProject('test-project');

			expect(count).toBe(3);

			const remaining = await getTriggerConfigsByProject('test-project');
			expect(remaining).toEqual([]);
		});

		it('returns 0 when the project has no trigger configs', async () => {
			const count = await deleteTriggerConfigsByProject('test-project');
			expect(count).toBe(0);
		});
	});

	// =========================================================================
	// bulkUpsertTriggerConfigs — transactional batch upsert
	// =========================================================================

	describe('bulkUpsertTriggerConfigs', () => {
		it('inserts multiple configs in a single call', async () => {
			const results = await bulkUpsertTriggerConfigs([
				{
					projectId: 'test-project',
					agentType: 'implementation',
					triggerEvent: 'pm:status-changed',
					enabled: true,
				},
				{
					projectId: 'test-project',
					agentType: 'review',
					triggerEvent: 'scm:pr-opened',
					enabled: false,
				},
				{
					projectId: 'test-project',
					agentType: 'planning',
					triggerEvent: 'pm:label-added',
					enabled: true,
				},
			]);

			expect(results).toHaveLength(3);
			expect(results.map((r) => r.agentType).sort()).toEqual([
				'implementation',
				'planning',
				'review',
			]);
		});

		it('updates existing configs on conflict within a bulk upsert', async () => {
			// Insert an existing config first
			const existing = await upsertTriggerConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
				parameters: { old: true },
			});

			// Bulk upsert with an update to the same key
			const results = await bulkUpsertTriggerConfigs([
				{
					projectId: 'test-project',
					agentType: 'implementation',
					triggerEvent: 'pm:status-changed',
					enabled: false,
					parameters: { old: false },
				},
				{
					projectId: 'test-project',
					agentType: 'review',
					triggerEvent: 'scm:pr-opened',
					enabled: true,
				},
			]);

			expect(results).toHaveLength(2);

			const implResult = results.find((r) => r.agentType === 'implementation');
			expect(implResult?.id).toBe(existing.id); // same row, no duplicate
			expect(implResult?.enabled).toBe(false);
			expect(implResult?.parameters).toEqual({ old: false });

			// Total rows = 2 (one updated + one inserted)
			const all = await getTriggerConfigsByProject('test-project');
			expect(all).toHaveLength(2);
		});

		it('returns empty array when given an empty list', async () => {
			const results = await bulkUpsertTriggerConfigs([]);
			expect(results).toEqual([]);
		});
	});

	// =========================================================================
	// JSONB round-trip
	// =========================================================================

	describe('JSONB parameter round-trip', () => {
		it('persists and retrieves nested parameter objects correctly', async () => {
			const params = {
				authorMode: 'own',
				threshold: 0.8,
				nested: {
					labels: ['bug', 'enhancement'],
					priority: 1,
				},
				flag: true,
			};

			const config = await upsertTriggerConfig({
				projectId: 'test-project',
				agentType: 'review',
				triggerEvent: 'scm:check-suite-success',
				parameters: params,
			});

			// Read back via composite key
			const fetched = await getTriggerConfig('test-project', 'review', 'scm:check-suite-success');

			expect(fetched?.parameters).toEqual(params);
			expect(fetched?.parameters.authorMode).toBe('own');
			expect(fetched?.parameters.threshold).toBe(0.8);
			expect((fetched?.parameters.nested as Record<string, unknown>)?.labels).toEqual([
				'bug',
				'enhancement',
			]);
			expect((fetched?.parameters.nested as Record<string, unknown>)?.priority).toBe(1);
			expect(fetched?.parameters.flag).toBe(true);
		});

		it('preserves JSONB parameters through updateTriggerConfig', async () => {
			const seeded = await seedTriggerConfig({
				agentType: 'review',
				triggerEvent: 'scm:check-suite-success',
				parameters: { authorMode: 'own' },
			});

			const updated = await updateTriggerConfig(seeded.id, {
				parameters: { authorMode: 'external', threshold: 0.95 },
			});

			expect(updated?.parameters).toEqual({ authorMode: 'external', threshold: 0.95 });
		});
	});

	// =========================================================================
	// Cascade delete — deleting a project removes its trigger configs
	// =========================================================================

	describe('cascade delete on project deletion', () => {
		it('removes trigger configs when the parent project is deleted', async () => {
			await seedTriggerConfig({ agentType: 'implementation', triggerEvent: 'pm:status-changed' });
			await seedTriggerConfig({ agentType: 'review', triggerEvent: 'scm:pr-opened' });

			// Confirm they exist
			const before = await getTriggerConfigsByProject('test-project');
			expect(before).toHaveLength(2);

			// Delete the project directly via the DB client
			const { getDb } = await import('../../../src/db/client.js');
			const { projects } = await import('../../../src/db/schema/index.js');
			const { eq } = await import('drizzle-orm');
			await getDb().delete(projects).where(eq(projects.id, 'test-project'));

			// Trigger configs should be gone (FK CASCADE DELETE)
			const after = await getTriggerConfigsByProject('test-project');
			expect(after).toEqual([]);
		});
	});

	// =========================================================================
	// Cross-project isolation
	// =========================================================================

	describe('cross-project isolation', () => {
		it('configs from project A are invisible when querying project B', async () => {
			// Seed a second project
			await seedProject({ id: 'project-b', name: 'Project B', repo: 'owner/repo-b' });

			// Seed configs for both projects
			await seedTriggerConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
			});
			await seedTriggerConfig({
				projectId: 'project-b',
				agentType: 'review',
				triggerEvent: 'scm:pr-opened',
			});

			const projectAConfigs = await getTriggerConfigsByProject('test-project');
			const projectBConfigs = await getTriggerConfigsByProject('project-b');

			expect(projectAConfigs).toHaveLength(1);
			expect(projectAConfigs[0].agentType).toBe('implementation');

			expect(projectBConfigs).toHaveLength(1);
			expect(projectBConfigs[0].agentType).toBe('review');
		});

		it('getTriggerConfig does not return configs from another project for the same key', async () => {
			await seedProject({ id: 'project-b', name: 'Project B', repo: 'owner/repo-b' });

			// Same agentType + triggerEvent but different project
			await seedTriggerConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: true,
			});
			await seedTriggerConfig({
				projectId: 'project-b',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
				enabled: false,
			});

			const configA = await getTriggerConfig('test-project', 'implementation', 'pm:status-changed');
			const configB = await getTriggerConfig('project-b', 'implementation', 'pm:status-changed');

			expect(configA?.enabled).toBe(true);
			expect(configB?.enabled).toBe(false);
		});

		it('getTriggerConfigsByProjectAndAgent only returns configs for the specified project', async () => {
			await seedProject({ id: 'project-b', name: 'Project B', repo: 'owner/repo-b' });

			await seedTriggerConfig({
				projectId: 'test-project',
				agentType: 'review',
				triggerEvent: 'scm:pr-opened',
			});
			await seedTriggerConfig({
				projectId: 'project-b',
				agentType: 'review',
				triggerEvent: 'scm:pr-opened',
			});

			const configsA = await getTriggerConfigsByProjectAndAgent('test-project', 'review');
			const configsB = await getTriggerConfigsByProjectAndAgent('project-b', 'review');

			expect(configsA).toHaveLength(1);
			expect(configsA[0].projectId).toBe('test-project');

			expect(configsB).toHaveLength(1);
			expect(configsB[0].projectId).toBe('project-b');
		});

		it('deleteTriggerConfigsByProject only deletes configs for the specified project', async () => {
			await seedProject({ id: 'project-b', name: 'Project B', repo: 'owner/repo-b' });

			await seedTriggerConfig({
				projectId: 'test-project',
				agentType: 'implementation',
				triggerEvent: 'pm:status-changed',
			});
			await seedTriggerConfig({
				projectId: 'project-b',
				agentType: 'review',
				triggerEvent: 'scm:pr-opened',
			});

			const deleted = await deleteTriggerConfigsByProject('test-project');
			expect(deleted).toBe(1);

			// Project A configs gone
			const configsA = await getTriggerConfigsByProject('test-project');
			expect(configsA).toEqual([]);

			// Project B configs untouched
			const configsB = await getTriggerConfigsByProject('project-b');
			expect(configsB).toHaveLength(1);
		});
	});
});

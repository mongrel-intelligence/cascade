/**
 * Integration test for migration 0050: Trello pm:status-changed onCreate/onMove
 * backfill.
 *
 * The migration is idempotent and runs at test bootstrap; this test seeds rows
 * that look like pre-migration state, runs the migration SQL again, and
 * verifies Trello rows are backfilled while non-Trello rows are untouched.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/client.js';
import { agentTriggerConfigs } from '../../../src/db/schema/index.js';
import { truncateAll } from '../helpers/db.js';
import { seedIntegration, seedOrg, seedProject, seedTriggerConfig } from '../helpers/seed.js';

const MIGRATION_PATH = fileURLToPath(
	new URL(
		'../../../src/db/migrations/0050_trello_status_changed_on_create_backfill.sql',
		import.meta.url,
	),
);

async function runMigrationSql(): Promise<void> {
	const migrationText = await readFile(MIGRATION_PATH, 'utf-8');
	// Strip transaction boundaries; drizzle's raw sql tag runs inside its own conn
	const body = migrationText
		.split('\n')
		.filter((line) => !/^\s*(BEGIN|COMMIT)\s*;?\s*$/i.test(line))
		.join('\n');
	await getDb().execute(sql.raw(body));
}

async function getParameters(projectId: string): Promise<Record<string, unknown>> {
	const rows = await getDb()
		.select()
		.from(agentTriggerConfigs)
		.where(sql`${agentTriggerConfigs.projectId} = ${projectId}`);
	return (rows[0]?.parameters ?? {}) as Record<string, unknown>;
}

describe('migration 0050 — Trello pm:status-changed onCreate/onMove backfill', () => {
	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
	});

	it('backfills onCreate=true and onMove=true for a Trello project', async () => {
		await seedProject({ id: 'trello-proj' });
		await seedIntegration({ projectId: 'trello-proj', category: 'pm', provider: 'trello' });
		await seedTriggerConfig({
			projectId: 'trello-proj',
			agentType: 'implementation',
			triggerEvent: 'pm:status-changed',
			parameters: {},
		});

		await runMigrationSql();

		const params = await getParameters('trello-proj');
		expect(params.onCreate).toBe(true);
		expect(params.onMove).toBe(true);
	});

	it('preserves pre-existing keys when backfilling Trello', async () => {
		await seedProject({ id: 'trello-proj' });
		await seedIntegration({ projectId: 'trello-proj', category: 'pm', provider: 'trello' });
		await seedTriggerConfig({
			projectId: 'trello-proj',
			agentType: 'splitting',
			triggerEvent: 'pm:status-changed',
			parameters: { targetStatus: 'splitting' },
		});

		await runMigrationSql();

		const params = await getParameters('trello-proj');
		expect(params).toEqual({
			targetStatus: 'splitting',
			onCreate: true,
			onMove: true,
		});
	});

	it('does NOT modify user-set keys on Trello projects (onCreate=false stays false)', async () => {
		await seedProject({ id: 'trello-proj' });
		await seedIntegration({ projectId: 'trello-proj', category: 'pm', provider: 'trello' });
		await seedTriggerConfig({
			projectId: 'trello-proj',
			agentType: 'implementation',
			triggerEvent: 'pm:status-changed',
			parameters: { onCreate: false },
		});

		await runMigrationSql();

		const params = await getParameters('trello-proj');
		expect(params.onCreate).toBe(false);
		expect(params.onMove).toBe(true);
	});

	it('does NOT touch Linear projects', async () => {
		await seedProject({ id: 'linear-proj' });
		await seedIntegration({ projectId: 'linear-proj', category: 'pm', provider: 'linear' });
		await seedTriggerConfig({
			projectId: 'linear-proj',
			agentType: 'implementation',
			triggerEvent: 'pm:status-changed',
			parameters: {},
		});

		await runMigrationSql();

		const params = await getParameters('linear-proj');
		expect(params).toEqual({});
	});

	it('does NOT touch JIRA projects', async () => {
		await seedProject({ id: 'jira-proj' });
		await seedIntegration({ projectId: 'jira-proj', category: 'pm', provider: 'jira' });
		await seedTriggerConfig({
			projectId: 'jira-proj',
			agentType: 'implementation',
			triggerEvent: 'pm:status-changed',
			parameters: {},
		});

		await runMigrationSql();

		const params = await getParameters('jira-proj');
		expect(params).toEqual({});
	});

	it('does NOT modify non pm:status-changed rows for Trello projects', async () => {
		await seedProject({ id: 'trello-proj' });
		await seedIntegration({ projectId: 'trello-proj', category: 'pm', provider: 'trello' });
		await seedTriggerConfig({
			projectId: 'trello-proj',
			agentType: 'implementation',
			triggerEvent: 'pm:label-added',
			parameters: {},
		});

		await runMigrationSql();

		const params = await getParameters('trello-proj');
		expect(params).toEqual({});
	});

	it('is idempotent: re-running leaves a backfilled Trello row unchanged', async () => {
		await seedProject({ id: 'trello-proj' });
		await seedIntegration({ projectId: 'trello-proj', category: 'pm', provider: 'trello' });
		await seedTriggerConfig({
			projectId: 'trello-proj',
			agentType: 'implementation',
			triggerEvent: 'pm:status-changed',
			parameters: {},
		});

		await runMigrationSql();
		const first = await getParameters('trello-proj');

		await runMigrationSql();
		const second = await getParameters('trello-proj');

		expect(second).toEqual(first);
	});
});

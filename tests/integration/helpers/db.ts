import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from '../../../src/db/client.js';

/**
 * Runs Drizzle migrations against the test database.
 * Uses the app's own getDb() which reads DATABASE_URL (set by integration/setup.ts).
 */
export async function runMigrations() {
	const db = getDb();
	await migrate(db, {
		migrationsFolder: path.resolve(import.meta.dirname, '../../../src/db/migrations'),
	});
}

/**
 * Truncates all application tables in dependency order.
 * Call in `beforeEach` to isolate tests.
 */
export async function truncateAll() {
	const db = getDb();
	// CASCADE handles FK dependencies; tables listed for explicitness
	await db.execute(`
		TRUNCATE TABLE
			webhook_logs,
			debug_analyses,
			agent_run_llm_calls,
			agent_run_logs,
			agent_runs,
			pr_work_items,
			integration_credentials,
			project_integrations,
			agent_trigger_configs,
			agent_configs,
			prompt_partials,
			sessions,
			users,
			credentials,
			projects,
			organizations
		CASCADE
	`);
}

/**
 * Closes the test database pool. Call in `afterAll`.
 */
export async function closeTestDb() {
	await closeDb();
}

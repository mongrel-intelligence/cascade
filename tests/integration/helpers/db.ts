import { execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { _setTestDb, closeDb, getDb } from '../../../src/db/client.js';

function checkPortReachable(host: string, port: number, timeoutMs = 500): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = net.connect({ host, port });
		const done = (result: boolean) => {
			socket.destroy();
			resolve(result);
		};
		socket.once('connect', () => done(true));
		socket.once('error', () => done(false));
		socket.setTimeout(timeoutMs, () => done(false));
	});
}

/**
 * Reads TEST_DATABASE_URL from .cascade/env (machine-specific config written by setup.sh).
 * Falls back for environments where .cascade/env is not exported into the process environment,
 * e.g. cascade worker containers where the file exists but the shell doesn't source it.
 */
function readTestDbUrlFromCascadeEnv(): string | null {
	try {
		const envFile = path.resolve(import.meta.dirname, '../../../.cascade/env');
		const contents = fs.readFileSync(envFile, 'utf-8');
		const match = contents.match(/^TEST_DATABASE_URL=(.+)$/m);
		return match ? match[1].trim() : null;
	} catch {
		return null;
	}
}

function resolveContainerIp(containerName: string): string | null {
	try {
		const ip = execSync(
			`docker inspect ${containerName} --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`,
			{ encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
		).trim();
		return ip || null;
	} catch {
		return null;
	}
}

async function tryUrl(url: string): Promise<boolean> {
	try {
		const u = new URL(url);
		const port = Number.parseInt(u.port || '5432', 10);
		return await checkPortReachable(u.hostname, port);
	} catch {
		return false;
	}
}

export async function resolveTestDbUrl(): Promise<string | null> {
	// 1. TEST_DATABASE_URL from process environment — check it's actually reachable
	const envUrl = process.env.TEST_DATABASE_URL;
	if (envUrl && (await tryUrl(envUrl))) return envUrl;

	// 2. TEST_DATABASE_URL from .cascade/env (machine-specific config written by setup.sh).
	//    Falls back for cascade worker containers where the file exists but the shell doesn't
	//    export the variable into the process environment.
	const cascadeEnvUrl = readTestDbUrlFromCascadeEnv();
	if (cascadeEnvUrl && cascadeEnvUrl !== envUrl && (await tryUrl(cascadeEnvUrl))) {
		return cascadeEnvUrl;
	}

	// 3. Docker Compose default (standard Docker / CI)
	if (await checkPortReachable('127.0.0.1', 5433)) {
		return 'postgresql://cascade_test:cascade_test@127.0.0.1:5433/cascade_test';
	}

	// 4. Container bridge IP — rootless Docker workaround
	const ip = resolveContainerIp('cascade-postgres-test');
	if (ip && (await checkPortReachable(ip, 5432))) {
		return `postgresql://cascade_test:cascade_test@${ip}:5432/cascade_test`;
	}

	// 5. No database reachable
	return null;
}

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
			project_credentials,
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

const ROLLBACK = Symbol('TEST_ROLLBACK');

/**
 * Wraps a test body in a transaction that is always rolled back.
 * Use this instead of truncateAll() for faster, isolated integration tests.
 *
 * Usage:
 *   it('does something', withTestTransaction(async () => {
 *     await seedOrg();
 *     // ... assertions ...
 *   }));
 */
export function withTestTransaction(fn: () => Promise<void>): () => Promise<void> {
	return async () => {
		try {
			await getDb().transaction(async (tx) => {
				_setTestDb(tx as ReturnType<typeof getDb>);
				try {
					await fn();
				} finally {
					_setTestDb(null);
				}
				throw ROLLBACK; // always roll back
			});
		} catch (e) {
			if (e !== ROLLBACK) throw e;
		}
	};
}

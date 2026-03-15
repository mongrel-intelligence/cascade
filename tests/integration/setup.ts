import pg from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { closeTestDb, resolveTestDbUrl, runMigrations } from './helpers/db.js';

async function tryCreateDatabase(dbUrl: string): Promise<void> {
	let parsed: URL;
	try {
		parsed = new URL(dbUrl);
	} catch {
		return;
	}
	const dbName = parsed.pathname.slice(1);
	if (!dbName) return;
	const adminUrl = new URL(dbUrl);
	adminUrl.pathname = '/postgres';
	const client = new pg.Client({ connectionString: adminUrl.toString() });
	try {
		await client.connect();
		await client.query(`CREATE DATABASE "${dbName}"`);
	} catch {
		// "already exists" (42P04) is fine; all others silently ignored
	} finally {
		await client.end().catch(() => {});
	}
}

const candidateUrl = process.env.TEST_DATABASE_URL;
if (candidateUrl) {
	await tryCreateDatabase(candidateUrl);
}

const resolvedUrl = await resolveTestDbUrl();

if (!resolvedUrl) {
	console.warn(
		'[integration] No reachable test database found — skipping all integration tests.\n' +
			'  Run `npm run test:db:up` to start the Docker Compose test database.',
	);
} else {
	process.env.DATABASE_URL = resolvedUrl;
	process.env.DATABASE_SSL = 'false';

	beforeAll(async () => {
		await runMigrations();
	});

	afterAll(async () => {
		await closeTestDb();
	});
}

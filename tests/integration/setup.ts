import { afterAll, beforeAll } from 'vitest';
import { closeTestDb, resolveTestDbUrl, runMigrations } from './helpers/db.js';

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

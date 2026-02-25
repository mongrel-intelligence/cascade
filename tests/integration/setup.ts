import { afterAll, beforeAll } from 'vitest';
import { closeTestDb, runMigrations } from './helpers/db.js';

// Default: matches docker-compose.test.yml (port 5433, user cascade_test)
// Override via TEST_DATABASE_URL for:
//   - .cascade/env: local PostgreSQL (port 5432, user postgres)
//   - CI: GitHub Actions service container (port 5433, user cascade_test)
const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	'postgresql://cascade_test:cascade_test@localhost:5433/cascade_test';

// Point the app's getDb() at the test database
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.DATABASE_SSL = 'false';

beforeAll(async () => {
	await runMigrations();
});

afterAll(async () => {
	await closeTestDb();
});

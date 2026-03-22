import fs from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let pool: pg.Pool | null = null;
let _testDbOverride: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** Test-only: override the DB instance returned by getDb(). */
export function _setTestDb(db: ReturnType<typeof drizzle<typeof schema>> | null): void {
	_testDbOverride = db;
}

function getDatabaseUrl(): string {
	if (process.env.DATABASE_URL) {
		return process.env.DATABASE_URL;
	}

	const host = process.env.CASCADE_POSTGRES_HOST;
	const port = process.env.CASCADE_POSTGRES_PORT || '6543';
	if (host) {
		const user = process.env.CASCADE_POSTGRES_USER || 'postgres';
		const password = process.env.CASCADE_POSTGRES_PASSWORD || '';
		const database = process.env.CASCADE_POSTGRES_DB || 'cascade';
		return `postgresql://${user}:${password}@${host}:${port}/${database}`;
	}

	throw new Error('DATABASE_URL or CASCADE_POSTGRES_HOST must be set');
}

function getSslConfig(): false | { rejectUnauthorized: boolean; ca?: string } {
	if (process.env.DATABASE_SSL === 'false') {
		return false;
	}
	const sslConfig: { rejectUnauthorized: boolean; ca?: string } = { rejectUnauthorized: true };
	if (process.env.DATABASE_CA_CERT) {
		sslConfig.ca = fs.readFileSync(process.env.DATABASE_CA_CERT, 'utf8');
	}
	return sslConfig;
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
	if (_testDbOverride) return _testDbOverride;
	if (!db) {
		pool = new pg.Pool({
			connectionString: getDatabaseUrl(),
			max: 5,
			ssl: getSslConfig(),
		});
		db = drizzle(pool, { schema });
	}
	return db;
}

export async function closeDb(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = null;
		db = null;
	}
}

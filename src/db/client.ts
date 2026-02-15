import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let pool: pg.Pool | null = null;

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

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
	if (!db) {
		pool = new pg.Pool({
			connectionString: getDatabaseUrl(),
			max: 5,
			ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
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

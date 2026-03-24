import fs, { existsSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

// ============================================================================
// DatabaseContext class
// ============================================================================

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

interface DatabaseConfig {
	connectionString: string;
	max?: number;
	ssl: false | { rejectUnauthorized: boolean; ca?: string };
}

/**
 * Encapsulates a Drizzle database instance and its underlying connection pool.
 * Use `createDatabaseContext()` to create instances.
 */
export class DatabaseContext {
	private db: DrizzleDb;
	private pool: pg.Pool;

	constructor(config: DatabaseConfig) {
		this.pool = new pg.Pool({
			connectionString: config.connectionString,
			max: config.max ?? 5,
			ssl: config.ssl,
		});
		this.db = drizzle(this.pool, { schema });
	}

	getDb(): DrizzleDb {
		return this.db;
	}

	async close(): Promise<void> {
		await this.pool.end();
	}
}

/**
 * Factory function that creates a DatabaseContext from environment variables.
 */
export function createDatabaseContext(): DatabaseContext {
	return new DatabaseContext({
		connectionString: getDatabaseUrl(),
		ssl: getSslConfig(),
	});
}

// ============================================================================
// Default global context (lazy singleton)
// ============================================================================

let _defaultContext: DatabaseContext | null = null;

/**
 * Set the default DatabaseContext used by `getDb()`.
 * Replaces `_setTestDb()` — use this in tests to inject a mock database.
 */
export function setDefaultDatabaseContext(context: DatabaseContext | null): void {
	_defaultContext = context;
}

/**
 * @deprecated Use `setDefaultDatabaseContext()` instead.
 * Kept for backward compatibility during migration.
 */
export function _setTestDb(db: DrizzleDb | null): void {
	if (db === null) {
		_defaultContext = null;
	} else {
		// Wrap the raw db in a minimal DatabaseContext-like object
		_defaultContext = {
			getDb: () => db,
			close: async () => {},
		} as DatabaseContext;
	}
}

// ============================================================================
// Module-level API (backward-compatible)
// ============================================================================

/**
 * Returns the default database instance.
 * Lazily initializes a global DatabaseContext on first call.
 * If `setDefaultDatabaseContext()` has been called, returns that context's db.
 */
export function getDb(): DrizzleDb {
	if (!_defaultContext) {
		_defaultContext = createDatabaseContext();
	}
	return _defaultContext.getDb();
}

/**
 * Closes the default database connection pool and resets the context.
 * Safe to call even if the db has never been initialized.
 */
export async function closeDb(): Promise<void> {
	if (_defaultContext) {
		// Only close if it's a real DatabaseContext (has its own pool)
		// Skip if it was set via _setTestDb (which wraps a mock)
		try {
			await _defaultContext.close();
		} catch {
			// Ignore errors closing mock contexts
		}
		_defaultContext = null;
	}
}

// ============================================================================
// Internal helpers
// ============================================================================

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
		const certPath = process.env.DATABASE_CA_CERT;
		if (!existsSync(certPath)) {
			throw new Error(`DATABASE_CA_CERT file not found: ${certPath}`);
		}
		sslConfig.ca = fs.readFileSync(certPath, 'utf8');
	}
	return sslConfig;
}

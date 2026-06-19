import fs, { existsSync } from 'node:fs';

export type DbSslConfig = false | { rejectUnauthorized: boolean; ca?: string };

/**
 * Resolve node-postgres SSL options from DATABASE_SSL / DATABASE_CA_CERT.
 *
 * Modes (DATABASE_SSL):
 *   - `'false'`     → no TLS (local dev, or networks that terminate TLS elsewhere).
 *   - `'no-verify'` → TLS, but skip certificate verification. Required for managed
 *                     Postgres that REQUIRES TLS yet presents a self-signed / private-CA
 *                     certificate (e.g. Supabase's connection pooler). A CA file is not a
 *                     workable alternative there: spawned worker containers receive the
 *                     `DATABASE_*` env but no mounted cert file (see
 *                     `src/router/worker-container-launcher.ts`), so `DATABASE_CA_CERT`
 *                     would point at a nonexistent path inside every worker.
 *   - anything else → TLS WITH verification, plus an optional CA from `DATABASE_CA_CERT`.
 *
 * Single source of truth shared by the runtime DB client (`src/db/client.ts`) and
 * drizzle-kit migrations (`drizzle.config.ts`) so both connect identically.
 */
export function resolveDbSslConfig(): DbSslConfig {
	if (process.env.DATABASE_SSL === 'false') {
		return false;
	}
	if (process.env.DATABASE_SSL === 'no-verify') {
		return { rejectUnauthorized: false };
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

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

/**
 * Encode the `DATABASE_SSL` intent as a libpq `sslmode` query param on a connection URL.
 *
 * Needed for **drizzle-kit migrations only**: drizzle-kit connects via the `url` in
 * `drizzle.config.ts` but ignores a `dbCredentials.ssl` object when a `url` is set, so
 * `resolveDbSslConfig()` can't reach it — the SSL mode has to live in the connection
 * string instead. (The runtime client and the data-migration tools pass the resolved
 * `ssl` object directly, where the object form is honored.)
 *
 *   - `DATABASE_SSL=no-verify` → append `sslmode=no-verify` (TLS, skip cert verification)
 *   - `DATABASE_SSL=false`     → append `sslmode=disable` (no TLS)
 *   - otherwise                → URL unchanged (driver default; verification not forced
 *                                here to preserve existing local-dev behavior)
 *
 * No-ops on an empty URL or one that already pins an `sslmode`.
 */
export function applyDbSslModeToUrl(url: string): string {
	const mode = process.env.DATABASE_SSL;
	const sslmode = mode === 'false' ? 'disable' : mode === 'no-verify' ? 'no-verify' : undefined;
	if (!url || !sslmode || /[?&]sslmode=/.test(url)) {
		return url;
	}
	return `${url}${url.includes('?') ? '&' : '?'}sslmode=${sslmode}`;
}

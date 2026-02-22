/**
 * Environment scrubbing utility for worker processes.
 *
 * After credentials are set as individual env vars, this module removes
 * infrastructure secrets from process.env to prevent them from leaking
 * to agent subprocesses (e.g., via Tmux or shell execution).
 */

/**
 * Infrastructure env vars scrubbed after credential setup.
 * These are server-side secrets that should never be accessible to agent code.
 */
const SENSITIVE_ENV_KEYS = [
	'CREDENTIAL_MASTER_KEY',
	'DATABASE_URL',
	'DATABASE_SSL',
	'REDIS_URL',
] as const;

/**
 * Remove sensitive environment variables from process.env.
 *
 * Call this AFTER:
 * - Database connection pool is initialized (getDb())
 *
 * After scrubbing:
 * - Database pool continues to work (uses cached connection string)
 * - Credential resolution continues to work (reads individual env vars)
 * - Agent subprocesses cannot access infrastructure secrets
 */
export function scrubSensitiveEnv(): void {
	for (const key of SENSITIVE_ENV_KEYS) {
		delete process.env[key];
	}
}

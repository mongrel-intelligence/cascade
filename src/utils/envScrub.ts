/**
 * Environment scrubbing utility for worker processes.
 *
 * After credentials are decrypted and cached in memory, this module removes
 * sensitive environment variables from process.env to prevent them from leaking
 * to agent subprocesses (e.g., via Tmux or shell execution).
 */

/**
 * Environment variables that are scrubbed after credential resolution.
 * These are server-side secrets that should never be accessible to agent code.
 */
const SENSITIVE_ENV_KEYS = [
	'CREDENTIAL_MASTER_KEY',
	'DATABASE_URL',
	'DATABASE_SSL',
	'REDIS_URL',
	'CASCADE_CREDENTIALS',
	'CASCADE_CREDENTIALS_PROJECT_ID',
] as const;

/**
 * Remove sensitive environment variables from process.env.
 *
 * Call this AFTER:
 * - Database connection pool is initialized (getDb())
 * - Project credentials are decrypted and cached (getProjectSecrets())
 *
 * After scrubbing:
 * - Database pool continues to work (uses cached connection string)
 * - Credential resolution continues to work (uses cached decrypted values)
 * - Agent subprocesses cannot access these secrets
 */
export function scrubSensitiveEnv(): void {
	for (const key of SENSITIVE_ENV_KEYS) {
		delete process.env[key];
	}
}

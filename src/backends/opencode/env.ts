/**
 * Environment variable filtering for OpenCode agent subprocesses.
 *
 * Uses an allowlist approach: only explicitly approved variables pass through
 * from the host process. This prevents DATABASE_URL, REDIS_URL, and other
 * server-side secrets from leaking into agent environments.
 */

/** Exact variable names to pass through. */
export const ALLOWED_ENV_EXACT = new Set([
	// System
	'HOME',
	'PATH',
	'SHELL',
	'TERM',
	'USER',
	'LOGNAME',
	'LANG',
	'TZ',
	'TMPDIR',
	'HOSTNAME',

	// Provider auth — OpenCode supports multiple providers
	'ANTHROPIC_API_KEY',
	'OPENROUTER_API_KEY',

	// OpenCode config (JSON blob injected by CASCADE)
	'OPENCODE_CONFIG_CONTENT',

	// Squint
	'SQUINT_DB_PATH',

	// Node
	'NODE_PATH',
	'NODE_EXTRA_CA_CERTS',
	'NODE_TLS_REJECT_UNAUTHORIZED',

	// Editor / color
	'EDITOR',
	'VISUAL',
	'PAGER',
	'FORCE_COLOR',
	'NO_COLOR',
	'TERM_PROGRAM',
	'COLORTERM',
]);

/** Prefix patterns — any var starting with one of these passes through. */
export const ALLOWED_ENV_PREFIXES = ['LC_', 'XDG_', 'GIT_', 'SSH_', 'GPG_', 'DOCKER_'] as const;

/**
 * Defense-in-depth denylist. These are blocked even if a future allowlist
 * change accidentally matches them.
 */
export const BLOCKED_ENV_EXACT = new Set([
	'DATABASE_URL',
	'DATABASE_SSL',
	'REDIS_URL',
	'CREDENTIAL_MASTER_KEY',
	'JOB_ID',
	'JOB_TYPE',
	'JOB_DATA',
	'CASCADE_POSTGRES_HOST',
	'CASCADE_POSTGRES_PORT',
	'NODE_OPTIONS',
	'VSCODE_INSPECTOR_OPTIONS',
]);

/**
 * Filter process.env to only include safe variables for OpenCode agent subprocesses.
 *
 * Resolution order per key:
 * 1. If in BLOCKED_ENV_EXACT → skip
 * 2. If in ALLOWED_ENV_EXACT → include
 * 3. If matches any ALLOWED_ENV_PREFIXES → include
 * 4. Otherwise → skip
 */
function filterProcessEnv(
	processEnv: Record<string, string | undefined>,
): Record<string, string | undefined> {
	const result: Record<string, string | undefined> = {};

	for (const [key, value] of Object.entries(processEnv)) {
		if (value === undefined) continue;
		if (BLOCKED_ENV_EXACT.has(key)) continue;
		if (ALLOWED_ENV_EXACT.has(key)) {
			result[key] = value;
			continue;
		}
		if (ALLOWED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
			result[key] = value;
		}
	}

	return result;
}

/**
 * Build environment variables to pass through to the OpenCode subprocess.
 *
 * Uses an allowlist filter on process.env so only safe system variables
 * (HOME, PATH, locale, etc.) reach the subprocess. Server-side secrets
 * like DATABASE_URL are never passed through.
 *
 * Project-specific secrets (GITHUB_TOKEN, TRELLO_API_KEY, etc.) are
 * injected via projectSecrets, which are layered on top.
 *
 * Provider auth keys (ANTHROPIC_API_KEY, OPENROUTER_API_KEY) are passed
 * through from process.env if present, and can also be overridden via projectSecrets.
 */
export function buildOpencodeEnv(projectSecrets?: Record<string, string>): {
	env: Record<string, string | undefined>;
} {
	const env: Record<string, string | undefined> = {
		...filterProcessEnv(process.env),
		...projectSecrets,
	};

	return { env };
}

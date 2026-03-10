/**
 * Environment variable filtering for Claude Code agent subprocesses.
 *
 * Uses an allowlist approach: only explicitly approved variables pass through
 * from the host process. This prevents DATABASE_URL, REDIS_URL, and other
 * server-side secrets from leaking into agent environments.
 */

import { ENV_VAR_NAME as PROGRESS_COMMENT_ENV_VAR } from '../progressState.js';
import { GITHUB_ACK_COMMENT_ID_ENV_VAR } from '../secretBuilder.js';

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

	// Claude auth
	'CLAUDE_CODE_OAUTH_TOKEN',
	'ANTHROPIC_API_KEY',

	// Squint
	'SQUINT_DB_PATH',

	// Progress comment state (pre-seeded ack comment ID)
	PROGRESS_COMMENT_ENV_VAR,

	// GitHub ack comment ID for claude-code subprocess deletion after PR review
	GITHUB_ACK_COMMENT_ID_ENV_VAR,

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
 * Filter process.env to only include safe variables for agent subprocesses.
 *
 * Resolution order per key:
 * 1. If in BLOCKED_ENV_EXACT → skip
 * 2. If in ALLOWED_ENV_EXACT → include
 * 3. If matches any ALLOWED_ENV_PREFIXES → include
 * 4. Otherwise → skip
 */
export function filterProcessEnv(
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

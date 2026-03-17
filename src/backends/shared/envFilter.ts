/**
 * Shared environment variable filtering utilities for native-tool engine subprocesses.
 *
 * Uses an allowlist approach: only explicitly approved variables pass through
 * from the host process. This prevents DATABASE_URL, REDIS_URL, and other
 * server-side secrets from leaking into agent environments.
 *
 * Each engine imports the shared sets and merges in its own engine-specific
 * allowed variables before calling filterProcessEnv().
 */

import {
	PR_SIDECAR_ENV_VAR,
	PUSHED_CHANGES_SIDECAR_ENV_VAR,
	REVIEW_SIDECAR_ENV_VAR,
} from '../../gadgets/sessionState.js';
import { ENV_VAR_NAME as PROGRESS_COMMENT_ENV_VAR } from '../progressState.js';
import { GITHUB_ACK_COMMENT_ID_ENV_VAR } from '../secretBuilder.js';

/**
 * Defense-in-depth denylist. These are blocked even if a future allowlist
 * change accidentally matches them.
 */
export const SHARED_BLOCKED_ENV_EXACT = new Set([
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
 * Exact variable names shared across all engines.
 * Engines extend this set with their own auth vars.
 */
export const SHARED_ALLOWED_ENV_EXACT = new Set([
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

	// Progress comment state (pre-seeded ack comment ID)
	PROGRESS_COMMENT_ENV_VAR,

	// GitHub ack comment ID for subprocess deletion after PR review
	GITHUB_ACK_COMMENT_ID_ENV_VAR,
	PR_SIDECAR_ENV_VAR,
	PUSHED_CHANGES_SIDECAR_ENV_VAR,
	REVIEW_SIDECAR_ENV_VAR,

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
export const SHARED_ALLOWED_ENV_PREFIXES = [
	'LC_',
	'XDG_',
	'GIT_',
	'SSH_',
	'GPG_',
	'DOCKER_',
] as const;

/**
 * Filter process.env to only include safe variables for agent subprocesses.
 *
 * Resolution order per key:
 * 1. If in blockedEnvExact → skip
 * 2. If in allowedEnvExact → include
 * 3. If matches any allowedEnvPrefixes → include
 * 4. Otherwise → skip
 */
export function filterProcessEnv(
	processEnv: Record<string, string | undefined>,
	allowedEnvExact: Set<string> = SHARED_ALLOWED_ENV_EXACT,
	allowedEnvPrefixes: ReadonlyArray<string> = SHARED_ALLOWED_ENV_PREFIXES,
	blockedEnvExact: Set<string> = SHARED_BLOCKED_ENV_EXACT,
): Record<string, string | undefined> {
	const result: Record<string, string | undefined> = {};

	for (const [key, value] of Object.entries(processEnv)) {
		if (value === undefined) continue;
		if (blockedEnvExact.has(key)) continue;
		if (allowedEnvExact.has(key)) {
			result[key] = value;
			continue;
		}
		if (allowedEnvPrefixes.some((prefix) => key.startsWith(prefix))) {
			result[key] = value;
		}
	}

	return result;
}

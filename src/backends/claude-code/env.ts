/**
 * Environment variable filtering for Claude Code agent subprocesses.
 *
 * Uses an allowlist approach: only explicitly approved variables pass through
 * from the host process. This prevents DATABASE_URL, REDIS_URL, and other
 * server-side secrets from leaking into agent environments.
 */

import { buildNativeToolPath } from '../nativeToolRuntime.js';
import {
	SHARED_ALLOWED_ENV_EXACT,
	SHARED_ALLOWED_ENV_PREFIXES,
	SHARED_BLOCKED_ENV_EXACT,
	filterProcessEnv as sharedFilterProcessEnv,
} from '../shared/envFilter.js';

/** Exact variable names to pass through (shared + Claude Code-specific). */
export const ALLOWED_ENV_EXACT = new Set([
	...SHARED_ALLOWED_ENV_EXACT,

	// Claude auth
	'CLAUDE_CODE_OAUTH_TOKEN',
	'ANTHROPIC_API_KEY',

	// Squint
	'SQUINT_DB_PATH',
]);

/** Prefix patterns — any var starting with one of these passes through. */
export const ALLOWED_ENV_PREFIXES = SHARED_ALLOWED_ENV_PREFIXES;

/**
 * Defense-in-depth denylist. These are blocked even if a future allowlist
 * change accidentally matches them.
 */
export const BLOCKED_ENV_EXACT = SHARED_BLOCKED_ENV_EXACT;

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
	return sharedFilterProcessEnv(
		processEnv,
		ALLOWED_ENV_EXACT,
		ALLOWED_ENV_PREFIXES,
		BLOCKED_ENV_EXACT,
	);
}

export function buildClaudeEnv(
	projectSecrets?: Record<string, string>,
	cliToolsDir?: string,
	nativeToolShimDir?: string,
): {
	env: Record<string, string | undefined>;
} {
	const env: Record<string, string | undefined> = {
		...filterProcessEnv(process.env),
		...projectSecrets,
		CLAUDE_AGENT_SDK_CLIENT_APP: 'cascade/1.0.0',
	};

	if (cliToolsDir) {
		env.PATH = buildNativeToolPath(env.PATH, cliToolsDir, nativeToolShimDir);
	}

	return { env };
}

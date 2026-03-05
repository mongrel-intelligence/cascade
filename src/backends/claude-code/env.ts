/**
 * Environment variable filtering for Claude Code agent subprocesses.
 *
 * Extends the shared base allowlist with Claude Code-specific keys.
 * Re-exports shared constants and filterProcessEnv for backward compatibility.
 */

import {
	ALLOWED_ENV_PREFIXES,
	BASE_ALLOWED_ENV_EXACT,
	BLOCKED_ENV_EXACT,
	filterProcessEnv as sharedFilterProcessEnv,
} from '../shared/env.js';

/** Claude Code-specific exact variable names (on top of the shared base). */
const CLAUDE_CODE_EXTRA_KEYS = ['CLAUDE_CODE_OAUTH_TOKEN'] as const;

/** Full allowlist for Claude Code: base + Claude-specific keys. */
export const ALLOWED_ENV_EXACT = new Set([...BASE_ALLOWED_ENV_EXACT, ...CLAUDE_CODE_EXTRA_KEYS]);

// Re-export shared constants so existing imports continue to work
export { ALLOWED_ENV_PREFIXES, BLOCKED_ENV_EXACT };

/**
 * Filter process.env to only include safe variables for Claude Code agent subprocesses.
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
	return sharedFilterProcessEnv(processEnv, ALLOWED_ENV_EXACT);
}

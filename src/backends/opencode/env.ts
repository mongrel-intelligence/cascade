/**
 * Environment variable filtering for OpenCode agent subprocesses.
 *
 * Extends the shared base allowlist with OpenCode-specific keys.
 * Re-exports shared constants for test access.
 */

import {
	ALLOWED_ENV_PREFIXES,
	BASE_ALLOWED_ENV_EXACT,
	BLOCKED_ENV_EXACT,
	filterProcessEnv as sharedFilterProcessEnv,
} from '../shared/env.js';

/** OpenCode-specific exact variable names (on top of the shared base). */
const OPENCODE_EXTRA_KEYS = ['OPENROUTER_API_KEY', 'OPENCODE_CONFIG_CONTENT'] as const;

/** Full allowlist for OpenCode: base + OpenCode-specific keys. */
export const ALLOWED_ENV_EXACT = new Set([...BASE_ALLOWED_ENV_EXACT, ...OPENCODE_EXTRA_KEYS]);

// Re-export shared constants so tests can access them
export { ALLOWED_ENV_PREFIXES, BLOCKED_ENV_EXACT };

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
		...sharedFilterProcessEnv(process.env, ALLOWED_ENV_EXACT),
		...projectSecrets,
	};

	return { env };
}

/**
 * Environment filtering for OpenCode CLI runs.
 *
 * Uses the same allowlist posture as other native-tool engines: keep only
 * explicitly safe host variables, then layer project-scoped secrets on top.
 *
 * The standalone filterProcessEnv wrapper has been removed — use
 * sharedFilterProcessEnv from shared/envFilter.js directly if needed.
 * The OpenCodeEngine class uses NativeToolEngine.buildEnv() via getAllowedEnvExact().
 */

import { buildEngineEnv } from '../shared/envBuilder.js';
import { SHARED_ALLOWED_ENV_EXACT } from '../shared/envFilter.js';

const ALLOWED_ENV_EXACT = new Set([
	...SHARED_ALLOWED_ENV_EXACT,

	// OpenCode auth
	'OPENAI_API_KEY',
	'ANTHROPIC_API_KEY',
	'OPENROUTER_API_KEY',

	// Squint
	'SQUINT_DB_PATH',
]);

export function buildEnv(
	projectSecrets?: Record<string, string>,
	cliToolsDir?: string,
	nativeToolShimDir?: string,
): Record<string, string | undefined> {
	return buildEngineEnv({
		allowedEnvExact: ALLOWED_ENV_EXACT,
		extraVars: { CI: 'true' },
		projectSecrets,
		cliToolsDir,
		nativeToolShimDir,
	});
}

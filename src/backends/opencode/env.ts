/**
 * Environment filtering for OpenCode CLI runs.
 *
 * Uses the same allowlist posture as other native-tool engines: keep only
 * explicitly safe host variables, then layer project-scoped secrets on top.
 */

import { buildNativeToolPath } from '../nativeToolRuntime.js';
import {
	SHARED_ALLOWED_ENV_EXACT,
	SHARED_ALLOWED_ENV_PREFIXES,
	SHARED_BLOCKED_ENV_EXACT,
	filterProcessEnv as sharedFilterProcessEnv,
} from '../shared/envFilter.js';

const ALLOWED_ENV_EXACT = new Set([
	...SHARED_ALLOWED_ENV_EXACT,

	// OpenCode auth
	'OPENAI_API_KEY',
	'ANTHROPIC_API_KEY',
	'OPENROUTER_API_KEY',
]);

const ALLOWED_ENV_PREFIXES = SHARED_ALLOWED_ENV_PREFIXES;

const BLOCKED_ENV_EXACT = SHARED_BLOCKED_ENV_EXACT;

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

export function buildEnv(
	projectSecrets?: Record<string, string>,
	cliToolsDir?: string,
	nativeToolShimDir?: string,
): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = {
		...filterProcessEnv(process.env),
		...projectSecrets,
		CI: 'true',
	};

	if (cliToolsDir) {
		env.PATH = buildNativeToolPath(env.PATH, cliToolsDir, nativeToolShimDir);
	}

	return env;
}

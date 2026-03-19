/**
 * Environment filtering for Codex CLI runs.
 *
 * Uses the same allowlist posture as other native-tool engines: keep only
 * explicitly safe host variables, then layer project-scoped secrets on top.
 */

import { buildEngineEnv } from '../shared/envBuilder.js';
import {
	SHARED_ALLOWED_ENV_EXACT,
	SHARED_ALLOWED_ENV_PREFIXES,
	SHARED_BLOCKED_ENV_EXACT,
	filterProcessEnv as sharedFilterProcessEnv,
} from '../shared/envFilter.js';

const ALLOWED_ENV_EXACT = new Set([
	...SHARED_ALLOWED_ENV_EXACT,

	// Codex auth
	'OPENAI_API_KEY',

	// Squint
	'SQUINT_DB_PATH',
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
	return buildEngineEnv({
		allowedEnvExact: ALLOWED_ENV_EXACT,
		extraVars: {
			CI: 'true',
			CODEX_DISABLE_UPDATE_NOTIFIER: '1',
		},
		projectSecrets,
		cliToolsDir,
		nativeToolShimDir,
	});
}

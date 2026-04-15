/**
 * Shared environment builder for native-tool engine subprocesses.
 *
 * All engines follow the same pattern:
 *   filterProcessEnv → spread project secrets → add engine-specific vars → buildPath
 *
 * This module centralises that common flow. Each engine passes its own
 * allowed env-var set, extra vars, and optional path config.
 */

import { buildNativeToolPath } from '../nativeToolRuntime.js';
import {
	SHARED_ALLOWED_ENV_EXACT,
	SHARED_ALLOWED_ENV_PREFIXES,
	SHARED_BLOCKED_ENV_EXACT,
	filterProcessEnv,
} from './envFilter.js';

export interface BuildEngineEnvOptions {
	/** Engine-specific exact-match env var allowlist (extends the shared set). */
	allowedEnvExact: Set<string>;
	/** Extra env vars to inject unconditionally (e.g. CI, CODEX_DISABLE_UPDATE_NOTIFIER). */
	extraVars?: Record<string, string>;
	/** Project-scoped credentials resolved from the DB. */
	projectSecrets?: Record<string, string>;
	/** Directory containing cascade-tools CLI binaries for PATH prepending. */
	cliToolsDir?: string;
	/** Directory containing native-tool shims (e.g. gh stub) for PATH prepending. */
	nativeToolShimDir?: string;
}

/**
 * Build a sanitised environment object for an engine subprocess.
 *
 * Resolution order:
 * 1. Filter process.env through the engine's allowlist
 * 2. Spread project secrets on top (overrides filtered vars)
 * 3. Spread engine-specific extra vars on top (e.g. CI=true)
 * 4. Prepend cliToolsDir / nativeToolShimDir to PATH when provided
 *
 * Returns a plain env-var record; callers that need a `{ env }` wrapper
 * (i.e. claude-code) should wrap the result themselves.
 */
export function buildEngineEnv(options: BuildEngineEnvOptions): Record<string, string | undefined> {
	const { allowedEnvExact, extraVars, projectSecrets, cliToolsDir, nativeToolShimDir } = options;

	const filteredEnv = filterProcessEnv(
		process.env,
		new Set([...SHARED_ALLOWED_ENV_EXACT, ...allowedEnvExact]),
		SHARED_ALLOWED_ENV_PREFIXES,
		SHARED_BLOCKED_ENV_EXACT,
	);

	const env: Record<string, string | undefined> = {
		...filteredEnv,
		...projectSecrets,
		...extraVars,
	};

	if (cliToolsDir) {
		env.PATH = buildNativeToolPath(env.PATH, cliToolsDir, nativeToolShimDir);
	}

	return env;
}

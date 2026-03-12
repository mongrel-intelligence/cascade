/**
 * Environment filtering for Codex CLI runs.
 *
 * Uses the same allowlist posture as other native-tool engines: keep only
 * explicitly safe host variables, then layer project-scoped secrets on top.
 */

import { PR_SIDECAR_ENV_VAR, REVIEW_SIDECAR_ENV_VAR } from '../../gadgets/sessionState.js';
import { buildNativeToolPath } from '../nativeToolRuntime.js';
import { ENV_VAR_NAME as PROGRESS_COMMENT_ENV_VAR } from '../progressState.js';
import { GITHUB_ACK_COMMENT_ID_ENV_VAR } from '../secretBuilder.js';

const ALLOWED_ENV_EXACT = new Set([
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

	// Codex auth
	'OPENAI_API_KEY',

	// Progress/session bridge
	PROGRESS_COMMENT_ENV_VAR,
	GITHUB_ACK_COMMENT_ID_ENV_VAR,
	PR_SIDECAR_ENV_VAR,
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

const ALLOWED_ENV_PREFIXES = ['LC_', 'XDG_', 'GIT_', 'SSH_', 'GPG_', 'DOCKER_'] as const;

const BLOCKED_ENV_EXACT = new Set([
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

export function buildEnv(
	projectSecrets?: Record<string, string>,
	cliToolsDir?: string,
	nativeToolShimDir?: string,
): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = {
		...filterProcessEnv(process.env),
		...projectSecrets,
		CI: 'true',
		CODEX_DISABLE_UPDATE_NOTIFIER: '1',
	};

	if (cliToolsDir) {
		env.PATH = buildNativeToolPath(env.PATH, cliToolsDir, nativeToolShimDir);
	}

	return env;
}

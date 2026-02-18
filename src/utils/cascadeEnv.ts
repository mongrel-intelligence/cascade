import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROTECTED_ENV_KEYS = new Set([
	'TRELLO_API_KEY',
	'TRELLO_TOKEN',
	'GITHUB_TOKEN',
	'OPENROUTER_API_KEY',
	'CASCADE_WORKSPACE_DIR',
	'CASCADE_LOCAL_MODE',
	'CASCADE_INTERACTIVE',
	'CONFIG_PATH',
	'PORT',
	'LOG_LEVEL',
	'LLMIST_LOG_FILE',
	'LLMIST_LOG_TEE',
	'REDIS_URL',
	'DATABASE_URL',
	'DATABASE_SSL',
	'CREDENTIAL_MASTER_KEY',
	'JOB_ID',
	'JOB_TYPE',
	'JOB_DATA',
]);

export interface EnvSnapshot {
	addedKeys: string[];
	overwritten: Map<string, string | undefined>;
}

export function parseEnvFile(content: string): Map<string, string> {
	const vars = new Map<string, string>();

	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const eqIndex = trimmed.indexOf('=');
		if (eqIndex === -1) continue;

		const key = trimmed.slice(0, eqIndex).trim();
		let value = trimmed.slice(eqIndex + 1);

		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		vars.set(key, value);
	}

	return vars;
}

export function loadCascadeEnv(
	repoDir: string,
	log: {
		info: (msg: string, meta?: Record<string, unknown>) => void;
		warn: (msg: string, meta?: Record<string, unknown>) => void;
	},
): EnvSnapshot | null {
	const envPath = join(repoDir, '.cascade', 'env');

	if (!existsSync(envPath)) return null;

	const content = readFileSync(envPath, 'utf-8');
	const vars = parseEnvFile(content);

	if (vars.size === 0) return null;

	const snapshot: EnvSnapshot = {
		addedKeys: [],
		overwritten: new Map(),
	};

	const loadedKeys: string[] = [];

	for (const [key, value] of vars) {
		if (PROTECTED_ENV_KEYS.has(key)) {
			log.warn('Skipping protected env var from .cascade/env', { key });
			continue;
		}

		if (key in process.env) {
			snapshot.overwritten.set(key, process.env[key]);
		} else {
			snapshot.addedKeys.push(key);
		}

		process.env[key] = value;
		loadedKeys.push(key);
	}

	if (loadedKeys.length > 0) {
		log.info('Loaded env vars from .cascade/env', { keys: loadedKeys });
	}

	return snapshot;
}

export function unloadCascadeEnv(snapshot: EnvSnapshot | null): void {
	if (!snapshot) return;

	for (const key of snapshot.addedKeys) {
		delete process.env[key];
	}

	for (const [key, value] of snapshot.overwritten) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

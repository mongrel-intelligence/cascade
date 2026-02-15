import {
	findProjectByBoardIdFromDb,
	findProjectByIdFromDb,
	findProjectByRepoFromDb,
	loadConfigFromDb,
} from '../db/repositories/configRepository.js';
import {
	getProjectSecret as getProjectSecretFromDb,
	getProjectSecrets as getProjectSecretsFromDb,
} from '../db/repositories/secretsRepository.js';
import type { CascadeConfig, ProjectConfig } from '../types/index.js';
import { configCache } from './configCache.js';

export async function loadConfig(): Promise<CascadeConfig> {
	const cached = configCache.getConfig();
	if (cached) return cached;

	const config = await loadConfigFromDb();
	configCache.setConfig(config);
	return config;
}

export async function findProjectByBoardId(boardId: string): Promise<ProjectConfig | undefined> {
	const cached = configCache.getProjectByBoardId(boardId);
	if (cached !== null) return cached;

	const project = await findProjectByBoardIdFromDb(boardId);
	configCache.setProjectByBoardId(boardId, project);
	return project;
}

export async function findProjectByRepo(repo: string): Promise<ProjectConfig | undefined> {
	const cached = configCache.getProjectByRepo(repo);
	if (cached !== null) return cached;

	const project = await findProjectByRepoFromDb(repo);
	configCache.setProjectByRepo(repo, project);
	return project;
}

export async function findProjectById(id: string): Promise<ProjectConfig | undefined> {
	// No cache for by-id lookups (less frequent, PK is fast)
	return findProjectByIdFromDb(id);
}

export async function getProjectSecret(
	projectId: string,
	key: string,
	fallbackEnvVar?: string,
): Promise<string> {
	// Check cached secrets first
	const cachedSecrets = configCache.getSecrets(projectId);
	if (cachedSecrets && key in cachedSecrets) {
		return cachedSecrets[key];
	}

	// Try DB
	const dbValue = await getProjectSecretFromDb(projectId, key);
	if (dbValue) return dbValue;

	// Fallback to env var
	const envKey = fallbackEnvVar ?? key;
	const envValue = process.env[envKey];
	if (envValue) return envValue;

	throw new Error(
		`Secret '${key}' not found for project '${projectId}' and env var '${envKey}' is not set`,
	);
}

export async function getProjectSecretOrNull(
	projectId: string,
	key: string,
	fallbackEnvVar?: string,
): Promise<string | null> {
	try {
		return await getProjectSecret(projectId, key, fallbackEnvVar);
	} catch {
		return null;
	}
}

export async function getProjectSecrets(projectId: string): Promise<Record<string, string>> {
	const cached = configCache.getSecrets(projectId);
	if (cached) return cached;

	const secrets = await getProjectSecretsFromDb(projectId);
	configCache.setSecrets(projectId, secrets);
	return secrets;
}

export function invalidateConfigCache(): void {
	configCache.invalidate();
}

import {
	findProjectByBoardIdFromDb,
	findProjectByIdFromDb,
	findProjectByRepoFromDb,
	loadConfigFromDb,
} from '../db/repositories/configRepository.js';
import {
	resolveAllCredentials,
	resolveCredential,
} from '../db/repositories/credentialsRepository.js';
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

/**
 * Resolve the org ID for a project. Cached to avoid repeated DB lookups.
 */
async function getOrgIdForProject(projectId: string): Promise<string> {
	const cached = configCache.getOrgIdForProject(projectId);
	if (cached) return cached;

	const project = await findProjectByIdFromDb(projectId);
	const orgId = project?.orgId ?? 'default';
	configCache.setOrgIdForProject(projectId, orgId);
	return orgId;
}

export async function getProjectSecret(projectId: string, key: string): Promise<string> {
	// Check cached secrets first
	const cachedSecrets = configCache.getSecrets(projectId);
	if (cachedSecrets && key in cachedSecrets) {
		return cachedSecrets[key];
	}

	// Resolve via credentials system (project override → org default)
	const orgId = await getOrgIdForProject(projectId);
	const dbValue = await resolveCredential(projectId, orgId, key);
	if (dbValue) return dbValue;

	throw new Error(`Secret '${key}' not found for project '${projectId}' in database`);
}

export async function getProjectSecretOrNull(
	projectId: string,
	key: string,
): Promise<string | null> {
	try {
		return await getProjectSecret(projectId, key);
	} catch {
		return null;
	}
}

export async function getProjectSecrets(projectId: string): Promise<Record<string, string>> {
	const cached = configCache.getSecrets(projectId);
	if (cached) return cached;

	const orgId = await getOrgIdForProject(projectId);
	const secrets = await resolveAllCredentials(projectId, orgId);
	configCache.setSecrets(projectId, secrets);
	return secrets;
}

export function invalidateConfigCache(): void {
	configCache.invalidate();
}

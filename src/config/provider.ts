import {
	findProjectByBoardIdFromDb,
	findProjectByIdFromDb,
	findProjectByJiraProjectKeyFromDb,
	findProjectByRepoFromDb,
	findProjectWithConfigByBoardId,
	findProjectWithConfigById,
	findProjectWithConfigByJiraProjectKey,
	findProjectWithConfigByRepo,
	loadConfigFromDb,
} from '../db/repositories/configRepository.js';
import {
	resolveAgentCredential,
	resolveAllCredentials,
	resolveCredential,
} from '../db/repositories/credentialsRepository.js';
import type { CascadeConfig, ProjectConfig } from '../types/index.js';
import { configCache } from './configCache.js';

/**
 * Permanent secrets store — no TTL. Secrets set at worker startup persist
 * for the entire process lifetime, avoiding re-decryption after env scrub.
 */
const secretsStore = new Map<string, Record<string, string>>();

/**
 * Store pre-decrypted secrets for a project. Unlike configCache entries these
 * never expire, so workers that scrub CREDENTIAL_MASTER_KEY from env can still
 * resolve credentials long after startup.
 */
export function setSecrets(projectId: string, secrets: Record<string, string>): void {
	secretsStore.set(projectId, secrets);
}

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

export async function findProjectByJiraProjectKey(
	projectKey: string,
): Promise<ProjectConfig | undefined> {
	const cached = configCache.getProjectByJiraKey(projectKey);
	if (cached !== null) return cached;

	const project = await findProjectByJiraProjectKeyFromDb(projectKey);
	configCache.setProjectByJiraKey(projectKey, project);
	return project;
}

export async function findProjectById(id: string): Promise<ProjectConfig | undefined> {
	// No cache for by-id lookups (less frequent, PK is fast)
	return findProjectByIdFromDb(id);
}

// --- Project + org-scoped config lookups (for webhook handlers / agent runners) ---

type ProjectWithConfig = { project: ProjectConfig; config: CascadeConfig };

export async function loadProjectConfigByBoardId(
	boardId: string,
): Promise<ProjectWithConfig | undefined> {
	return findProjectWithConfigByBoardId(boardId);
}

export async function loadProjectConfigByRepo(
	repo: string,
): Promise<ProjectWithConfig | undefined> {
	return findProjectWithConfigByRepo(repo);
}

export async function loadProjectConfigByJiraProjectKey(
	projectKey: string,
): Promise<ProjectWithConfig | undefined> {
	return findProjectWithConfigByJiraProjectKey(projectKey);
}

export async function loadProjectConfigById(id: string): Promise<ProjectWithConfig | undefined> {
	return findProjectWithConfigById(id);
}

/**
 * Resolve the org ID for a project. Cached to avoid repeated DB lookups.
 */
async function getOrgIdForProject(projectId: string): Promise<string> {
	const cached = configCache.getOrgIdForProject(projectId);
	if (cached) return cached;

	const project = await findProjectByIdFromDb(projectId);
	if (!project) {
		throw new Error(`Project not found: ${projectId}`);
	}
	const orgId = project.orgId;
	configCache.setOrgIdForProject(projectId, orgId);
	return orgId;
}

export async function getProjectSecret(projectId: string, key: string): Promise<string> {
	// Check permanent secrets store first (populated at worker startup)
	const cachedSecrets = secretsStore.get(projectId);
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
	const cached = secretsStore.get(projectId);
	if (cached) return cached;

	const orgId = await getOrgIdForProject(projectId);
	const secrets = await resolveAllCredentials(projectId, orgId);
	secretsStore.set(projectId, secrets);
	return secrets;
}

/**
 * Resolve a credential for a specific agent type.
 * Resolution: cache → agent+project override → project override → org default → null.
 */
export async function getAgentCredential(
	projectId: string,
	agentType: string,
	key: string,
): Promise<string | null> {
	// Check permanent secrets store first (from CASCADE_CREDENTIALS env var in workers)
	const cachedSecrets = secretsStore.get(projectId);
	if (cachedSecrets && key in cachedSecrets) {
		return cachedSecrets[key];
	}

	// Fall back to DB resolution (agent override → project override → org default)
	const orgId = await getOrgIdForProject(projectId);
	return resolveAgentCredential(projectId, orgId, agentType, key);
}

export function invalidateConfigCache(): void {
	configCache.invalidate();
	secretsStore.clear();
}

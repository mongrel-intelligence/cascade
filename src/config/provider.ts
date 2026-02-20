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
	resolveAllIntegrationCredentials,
	resolveAllOrgCredentials,
	resolveIntegrationCredential,
	resolveOrgCredential,
} from '../db/repositories/credentialsRepository.js';
import type { CascadeConfig, ProjectConfig } from '../types/index.js';
import { configCache } from './configCache.js';
import { PROVIDER_CREDENTIAL_ROLES } from './integrationRoles.js';
import type { IntegrationProvider } from './integrationRoles.js';

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

// ============================================================================
// Integration credentials — direct by category + role
// ============================================================================

/**
 * Resolve an integration credential for a project by category and role.
 * Throws if the credential is not found.
 */
export async function getIntegrationCredential(
	projectId: string,
	category: string,
	role: string,
): Promise<string> {
	// Check permanent secrets store first (populated at worker startup)
	const cachedSecrets = secretsStore.get(projectId);
	if (cachedSecrets) {
		// Map role to env var key for cache lookup
		const envKey = roleToEnvVarKey(category, role);
		if (envKey && envKey in cachedSecrets) {
			return cachedSecrets[envKey];
		}
	}

	const value = await resolveIntegrationCredential(projectId, category, role);
	if (value) return value;

	throw new Error(
		`Integration credential '${category}/${role}' not found for project '${projectId}'`,
	);
}

/**
 * Resolve an integration credential for a project, returning null if not found.
 */
export async function getIntegrationCredentialOrNull(
	projectId: string,
	category: string,
	role: string,
): Promise<string | null> {
	// Check permanent secrets store first
	const cachedSecrets = secretsStore.get(projectId);
	if (cachedSecrets) {
		const envKey = roleToEnvVarKey(category, role);
		if (envKey && envKey in cachedSecrets) {
			return cachedSecrets[envKey];
		}
	}

	return resolveIntegrationCredential(projectId, category, role);
}

// ============================================================================
// Non-integration (org-scoped) credentials
// ============================================================================

/**
 * Resolve a non-integration org-scoped credential by env var key.
 * Used for LLM API keys, etc.
 */
export async function getOrgCredential(
	projectId: string,
	envVarKey: string,
): Promise<string | null> {
	// Check permanent secrets store first
	const cachedSecrets = secretsStore.get(projectId);
	if (cachedSecrets && envVarKey in cachedSecrets) {
		return cachedSecrets[envVarKey];
	}

	const orgId = await getOrgIdForProject(projectId);
	return resolveOrgCredential(orgId, envVarKey);
}

// ============================================================================
// All credentials as flat env-var-key map (for worker environments)
// ============================================================================

/**
 * Build a flat env-var-key → value map of all credentials for a project.
 * 1. Loads all integration credentials and maps role→envVarKey
 * 2. Loads all org-default non-integration credentials
 * 3. Merges integration credentials over org defaults
 */
export async function getAllProjectCredentials(projectId: string): Promise<Record<string, string>> {
	const cached = secretsStore.get(projectId);
	if (cached) return cached;

	const orgId = await getOrgIdForProject(projectId);

	const [integrationCreds, orgCreds] = await Promise.all([
		resolveAllIntegrationCredentials(projectId),
		resolveAllOrgCredentials(orgId),
	]);

	// Start with org defaults
	const result: Record<string, string> = { ...orgCreds };

	// Overlay integration credentials (mapped by role→envVarKey)
	for (const cred of integrationCreds) {
		const roles = PROVIDER_CREDENTIAL_ROLES[cred.provider as IntegrationProvider];
		if (!roles) continue;
		const roleDef = roles.find((r) => r.role === cred.role);
		if (roleDef) {
			result[roleDef.envVarKey] = cred.value;
		}
	}

	secretsStore.set(projectId, result);
	return result;
}

export function invalidateConfigCache(): void {
	configCache.invalidate();
	secretsStore.clear();
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Map a category+role pair to the corresponding env var key.
 * Used for cache lookups in the secrets store.
 */
function roleToEnvVarKey(category: string, role: string): string | undefined {
	// Look through all providers in the category to find the role
	for (const [provider, roles] of Object.entries(PROVIDER_CREDENTIAL_ROLES)) {
		const providerCategory = provider === 'trello' || provider === 'jira' ? 'pm' : 'scm';
		if (providerCategory !== category) continue;
		const roleDef = roles.find((r) => r.role === role);
		if (roleDef) return roleDef.envVarKey;
	}
	return undefined;
}

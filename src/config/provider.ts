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
// Internal: 3-step env/worker/DB resolution helper
// ============================================================================

/**
 * Resolve a credential value using the standard 3-step pattern:
 * 1. Check process.env (populated at worker startup from router-supplied credentials)
 * 2. If in worker context (CASCADE_CREDENTIAL_KEYS set), credential is absent → return notFoundValue
 * 3. Otherwise resolve from DB via the provided async lookup
 */
async function resolveFromEnvOrDb<T>(
	envKey: string | undefined,
	notFoundValue: T,
	dbLookup: () => Promise<T>,
): Promise<T> {
	// Check process.env first (populated at worker startup from router-supplied credentials)
	if (envKey && process.env[envKey]) {
		return process.env[envKey] as T;
	}

	// Worker context: all credentials set by router, this one doesn't exist
	if (process.env.CASCADE_CREDENTIAL_KEYS) {
		return notFoundValue;
	}

	// Router/dashboard context: resolve from DB
	return dbLookup();
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
	const envKey = roleToEnvVarKey(category, role);
	const value = await resolveFromEnvOrDb<string | null>(envKey, null, () =>
		resolveIntegrationCredential(projectId, category, role),
	);
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
	const envKey = roleToEnvVarKey(category, role);
	return resolveFromEnvOrDb<string | null>(envKey, null, () =>
		resolveIntegrationCredential(projectId, category, role),
	);
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
	return resolveFromEnvOrDb<string | null>(envVarKey, null, async () => {
		const orgId = await getOrgIdForProject(projectId);
		return resolveOrgCredential(orgId, envVarKey);
	});
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
	// Worker context: reconstruct from individual env vars set by the router
	const keyList = process.env.CASCADE_CREDENTIAL_KEYS;
	if (keyList) {
		const result: Record<string, string> = {};
		for (const key of keyList.split(',')) {
			if (key && process.env[key]) {
				result[key] = process.env[key];
			}
		}
		return result;
	}

	// Router/dashboard context: resolve from DB (has CREDENTIAL_MASTER_KEY)
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

	return result;
}

export function invalidateConfigCache(): void {
	configCache.invalidate();
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Map a category+role pair to the corresponding env var key.
 * Used for process.env lookups in worker environments.
 */
function roleToEnvVarKey(category: string, role: string): string | undefined {
	// Look through all providers in the category to find the role
	for (const [provider, roles] of Object.entries(PROVIDER_CREDENTIAL_ROLES)) {
		let providerCategory: string;
		if (provider === 'trello' || provider === 'jira') {
			providerCategory = 'pm';
		} else if (provider === 'github') {
			providerCategory = 'scm';
		} else {
			continue;
		}
		if (providerCategory !== category) continue;
		const roleDef = roles.find((r) => r.role === role);
		if (roleDef) return roleDef.envVarKey;
	}
	return undefined;
}

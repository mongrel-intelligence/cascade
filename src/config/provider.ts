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
	resolveAllProjectCredentials,
	resolveProjectCredential,
} from '../db/repositories/credentialsRepository.js';
import type { CascadeConfig, ProjectConfig } from '../types/index.js';
import { configCache } from './configCache.js';
import { PROVIDER_CREDENTIAL_ROLES } from './integrationRoles.js';

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
	// Worker context: credentials are pre-loaded into env vars by the router.
	// Only use env vars here; never fall through to the DB.
	if (process.env.CASCADE_CREDENTIAL_KEYS) {
		return envKey && process.env[envKey] ? (process.env[envKey] as T) : notFoundValue;
	}

	// All other contexts (router, dashboard, tests): always resolve from DB.
	return dbLookup();
}

// ============================================================================
// Integration credentials — direct by category + role
// ============================================================================

/**
 * Resolve an integration credential for a project by category and role.
 * Resolves via project_credentials using the envVarKey mapping.
 * Throws if the credential is not found.
 */
export async function getIntegrationCredential(
	projectId: string,
	category: string,
	role: string,
): Promise<string> {
	const envKey = roleToEnvVarKey(category, role);
	const value = await resolveFromEnvOrDb<string | null>(envKey, null, () => {
		if (!envKey) return Promise.resolve(null);
		return resolveProjectCredential(projectId, envKey);
	});
	if (value) return value;

	throw new Error(
		`Integration credential '${category}/${role}' not found for project '${projectId}'`,
	);
}

/**
 * Resolve an integration credential for a project, returning null if not found.
 * Resolves via project_credentials using the envVarKey mapping.
 */
export async function getIntegrationCredentialOrNull(
	projectId: string,
	category: string,
	role: string,
): Promise<string | null> {
	const envKey = roleToEnvVarKey(category, role);
	return resolveFromEnvOrDb<string | null>(envKey, null, () => {
		if (!envKey) return Promise.resolve(null);
		return resolveProjectCredential(projectId, envKey);
	});
}

// ============================================================================
// Non-integration (org-scoped) credentials
// ============================================================================

/**
 * Resolve a non-integration credential by env var key.
 * Reads from project_credentials table — no org_id lookup needed.
 */
export async function getOrgCredential(
	projectId: string,
	envVarKey: string,
): Promise<string | null> {
	return resolveFromEnvOrDb<string | null>(envVarKey, null, () =>
		resolveProjectCredential(projectId, envVarKey),
	);
}

// ============================================================================
// All credentials as flat env-var-key map (for worker environments)
// ============================================================================

/**
 * Build a flat env-var-key → value map of all credentials for a project.
 * Single query against project_credentials filtered by project_id.
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

	// Router/dashboard context: single query against project_credentials
	return resolveAllProjectCredentials(projectId);
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

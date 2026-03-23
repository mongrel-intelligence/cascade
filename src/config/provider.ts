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
import { PROVIDER_CATEGORY, PROVIDER_CREDENTIAL_ROLES } from './integrationRoles.js';

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
// CredentialResolver interface and implementations
// ============================================================================

/**
 * Abstraction over credential resolution. Allows tests to inject a mock
 * resolver instead of manipulating process.env or the DB.
 */
export interface CredentialResolver {
	/**
	 * Resolve a single credential by env var key for a given project.
	 * Returns null if not found.
	 */
	resolve(projectId: string, key: string): Promise<string | null>;

	/**
	 * Resolve all credentials for a given project as a flat env-var-key → value map.
	 */
	resolveAll(projectId: string): Promise<Record<string, string>>;
}

/**
 * Production resolver: reads from the project_credentials DB table.
 */
export class DbCredentialResolver implements CredentialResolver {
	async resolve(projectId: string, key: string): Promise<string | null> {
		return resolveProjectCredential(projectId, key);
	}

	async resolveAll(projectId: string): Promise<Record<string, string>> {
		return resolveAllProjectCredentials(projectId);
	}
}

/**
 * Worker-context resolver: reads pre-loaded credentials from process.env.
 * Credentials are populated at worker startup from router-supplied env vars listed
 * in CASCADE_CREDENTIAL_KEYS. Never falls through to the DB.
 */
export class EnvCredentialResolver implements CredentialResolver {
	async resolve(_projectId: string, key: string): Promise<string | null> {
		return process.env[key] ?? null;
	}

	async resolveAll(_projectId: string): Promise<Record<string, string>> {
		const keyList = process.env.CASCADE_CREDENTIAL_KEYS ?? '';
		const result: Record<string, string> = {};
		for (const key of keyList.split(',')) {
			if (key && process.env[key]) {
				result[key] = process.env[key];
			}
		}
		return result;
	}
}

// Module-level resolver instance — auto-selected based on context, injectable for tests.
let _resolver: CredentialResolver | null = null;

/**
 * Get the active CredentialResolver instance.
 * Auto-selects based on CASCADE_CREDENTIAL_KEYS presence:
 *   - Set → EnvCredentialResolver (worker context)
 *   - Unset → DbCredentialResolver (router/dashboard/test context)
 *
 * Call setCredentialResolver() before this to override for tests.
 */
function getResolver(): CredentialResolver {
	if (_resolver) return _resolver;
	return process.env.CASCADE_CREDENTIAL_KEYS
		? new EnvCredentialResolver()
		: new DbCredentialResolver();
}

/**
 * Override the active CredentialResolver. Use in tests to inject a mock
 * resolver instead of manipulating process.env.
 *
 * Pass null to revert to auto-selection.
 */
export function setCredentialResolver(resolver: CredentialResolver | null): void {
	_resolver = resolver;
}

// ============================================================================
// Integration credentials — direct by category + role
// ============================================================================

/**
 * Resolve an integration credential for a project by category and role.
 * Resolves via the active CredentialResolver using the envVarKey mapping.
 * Throws if the credential is not found.
 */
export async function getIntegrationCredential(
	projectId: string,
	category: string,
	role: string,
): Promise<string> {
	const envKey = roleToEnvVarKey(category, role);
	if (!envKey) {
		throw new Error(
			`Integration credential '${category}/${role}' not found for project '${projectId}'`,
		);
	}
	const value = await getResolver().resolve(projectId, envKey);
	if (value) return value;

	throw new Error(
		`Integration credential '${category}/${role}' not found for project '${projectId}'`,
	);
}

/**
 * Resolve an integration credential for a project, returning null if not found.
 * Resolves via the active CredentialResolver using the envVarKey mapping.
 */
export async function getIntegrationCredentialOrNull(
	projectId: string,
	category: string,
	role: string,
): Promise<string | null> {
	const envKey = roleToEnvVarKey(category, role);
	if (!envKey) return null;
	return getResolver().resolve(projectId, envKey);
}

// ============================================================================
// Non-integration (org-scoped) credentials
// ============================================================================

/**
 * Resolve a non-integration credential by env var key.
 * Reads from the active CredentialResolver — no org_id lookup needed.
 */
export async function getOrgCredential(
	projectId: string,
	envVarKey: string,
): Promise<string | null> {
	return getResolver().resolve(projectId, envVarKey);
}

// ============================================================================
// All credentials as flat env-var-key map (for worker environments)
// ============================================================================

/**
 * Build a flat env-var-key → value map of all credentials for a project.
 * Single query against project_credentials filtered by project_id.
 */
export async function getAllProjectCredentials(projectId: string): Promise<Record<string, string>> {
	return getResolver().resolveAll(projectId);
}

export function invalidateConfigCache(): void {
	configCache.invalidate();
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Map a category+role pair to the corresponding env var key.
 * Used for env-var and DB lookups in resolver implementations.
 */
function roleToEnvVarKey(category: string, role: string): string | undefined {
	// Look through all providers in the category to find the role
	for (const [provider, roles] of Object.entries(PROVIDER_CREDENTIAL_ROLES)) {
		const providerCategory = PROVIDER_CATEGORY[provider as keyof typeof PROVIDER_CATEGORY];
		if (!providerCategory || providerCategory !== category) continue;
		const roleDef = roles.find((r) => r.role === role);
		if (roleDef) return roleDef.envVarKey;
	}
	return undefined;
}

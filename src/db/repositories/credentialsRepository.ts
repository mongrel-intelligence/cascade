import { and, eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { decryptCredential, encryptCredential } from '../crypto.js';
import {
	credentials,
	integrationCredentials,
	projectCredentials,
	projectIntegrations,
	projects,
} from '../schema/index.js';

// ============================================================================
// Project-scoped credential resolution (reads from project_credentials table)
// ============================================================================

/**
 * Resolve a single credential for a project by env var key.
 * Reads from the project_credentials table using projectId as AAD for decryption.
 */
export async function resolveProjectCredential(
	projectId: string,
	envVarKey: string,
): Promise<string | null> {
	const db = getDb();

	const [row] = await db
		.select({ value: projectCredentials.value })
		.from(projectCredentials)
		.where(
			and(eq(projectCredentials.projectId, projectId), eq(projectCredentials.envVarKey, envVarKey)),
		);

	if (!row) return null;
	return decryptCredential(row.value, projectId);
}

/**
 * Resolve all credentials for a project as a flat env-var-key → value map.
 * Single query against project_credentials, using projectId as AAD.
 * Throws if the project does not exist.
 */
export async function resolveAllProjectCredentials(
	projectId: string,
): Promise<Record<string, string>> {
	const db = getDb();

	const [project] = await db
		.select({ id: projects.id })
		.from(projects)
		.where(eq(projects.id, projectId));
	if (!project) {
		throw new Error(`Project not found: ${projectId}`);
	}

	const rows = await db
		.select({ envVarKey: projectCredentials.envVarKey, value: projectCredentials.value })
		.from(projectCredentials)
		.where(eq(projectCredentials.projectId, projectId));

	const result: Record<string, string> = {};
	for (const row of rows) {
		result[row.envVarKey] = decryptCredential(row.value, projectId);
	}
	return result;
}

/**
 * Upsert a row in project_credentials. Value must already be encrypted with
 * projectId as AAD (or plaintext if encryption is disabled).
 */
export async function upsertProjectCredential(
	projectId: string,
	envVarKey: string,
	value: string,
	name?: string | null,
): Promise<void> {
	const db = getDb();
	await db
		.insert(projectCredentials)
		.values({ projectId, envVarKey, value, name: name ?? null })
		.onConflictDoUpdate({
			target: [projectCredentials.projectId, projectCredentials.envVarKey],
			set: { value, name: name ?? null, updatedAt: new Date() },
		});
}

/**
 * Delete a row from project_credentials.
 */
export async function deleteProjectCredential(projectId: string, envVarKey: string): Promise<void> {
	const db = getDb();
	await db
		.delete(projectCredentials)
		.where(
			and(eq(projectCredentials.projectId, projectId), eq(projectCredentials.envVarKey, envVarKey)),
		);
}

// ============================================================================
// Project-scoped credential CRUD helpers (public API — transparent encryption)
// ============================================================================

/**
 * Read a single project credential by env var key.
 * Returns the decrypted plaintext value, or null if not found.
 * Uses projectId as AAD for decryption.
 */
export async function getProjectCredential(
	projectId: string,
	envVarKey: string,
): Promise<string | null> {
	return resolveProjectCredential(projectId, envVarKey);
}

/**
 * Write (upsert) a project credential with automatic encryption.
 * The plaintext value is encrypted using projectId as AAD before storage.
 */
export async function writeProjectCredential(
	projectId: string,
	envVarKey: string,
	value: string,
	name?: string | null,
): Promise<void> {
	const encryptedValue = encryptCredential(value, projectId);
	await upsertProjectCredential(projectId, envVarKey, encryptedValue, name);
}

/**
 * List all project credentials as an array of decrypted key-value records.
 * Uses projectId as AAD for decryption.
 */
export async function listProjectCredentials(
	projectId: string,
): Promise<{ envVarKey: string; value: string; name: string | null }[]> {
	const db = getDb();

	const rows = await db
		.select({
			envVarKey: projectCredentials.envVarKey,
			value: projectCredentials.value,
			name: projectCredentials.name,
		})
		.from(projectCredentials)
		.where(eq(projectCredentials.projectId, projectId));

	return rows.map((row) => ({
		envVarKey: row.envVarKey,
		value: decryptCredential(row.value, projectId),
		name: row.name,
	}));
}

// ============================================================================
// Integration credential resolution (legacy — kept for backward compatibility)
// ============================================================================

/**
 * Resolve a single integration credential for a project by category and role.
 * Joins integration_credentials → credentials via the project's integration.
 */
export async function resolveIntegrationCredential(
	projectId: string,
	category: string,
	role: string,
): Promise<string | null> {
	const db = getDb();

	const [row] = await db
		.select({ value: credentials.value, orgId: credentials.orgId })
		.from(integrationCredentials)
		.innerJoin(
			projectIntegrations,
			eq(integrationCredentials.integrationId, projectIntegrations.id),
		)
		.innerJoin(credentials, eq(integrationCredentials.credentialId, credentials.id))
		.where(
			and(
				eq(projectIntegrations.projectId, projectId),
				eq(projectIntegrations.category, category),
				eq(integrationCredentials.role, role),
			),
		);

	if (!row) return null;
	return decryptCredential(row.value, row.orgId);
}

/**
 * Resolve all integration credentials for all of a project's integrations.
 * Returns an array of { category, provider, role, value }.
 */
export async function resolveAllIntegrationCredentials(
	projectId: string,
): Promise<{ category: string; provider: string; role: string; value: string }[]> {
	const db = getDb();

	const rows = await db
		.select({
			category: projectIntegrations.category,
			provider: projectIntegrations.provider,
			role: integrationCredentials.role,
			value: credentials.value,
			orgId: credentials.orgId,
		})
		.from(integrationCredentials)
		.innerJoin(
			projectIntegrations,
			eq(integrationCredentials.integrationId, projectIntegrations.id),
		)
		.innerJoin(credentials, eq(integrationCredentials.credentialId, credentials.id))
		.where(eq(projectIntegrations.projectId, projectId));

	return rows.map((row) => ({
		category: row.category,
		provider: row.provider,
		role: row.role,
		value: decryptCredential(row.value, row.orgId),
	}));
}

// ============================================================================
// Org-scoped credential resolution (non-integration secrets like LLM API keys)
// ============================================================================

/**
 * Resolve an org-level default credential by env var key.
 * Used for non-integration secrets (LLM API keys, etc.).
 */
export async function resolveOrgCredential(
	orgId: string,
	envVarKey: string,
): Promise<string | null> {
	const db = getDb();
	const [row] = await db
		.select({ value: credentials.value })
		.from(credentials)
		.where(
			and(
				eq(credentials.orgId, orgId),
				eq(credentials.envVarKey, envVarKey),
				eq(credentials.isDefault, true),
			),
		);

	if (!row) return null;
	return decryptCredential(row.value, orgId);
}

/**
 * Resolve all org-default credentials as a key-value map.
 */
export async function resolveAllOrgCredentials(orgId: string): Promise<Record<string, string>> {
	const db = getDb();
	const result: Record<string, string> = {};

	const rows = await db
		.select({ envVarKey: credentials.envVarKey, value: credentials.value })
		.from(credentials)
		.where(and(eq(credentials.orgId, orgId), eq(credentials.isDefault, true)));

	for (const row of rows) {
		result[row.envVarKey] = decryptCredential(row.value, orgId);
	}

	return result;
}

// ============================================================================
// Integration metadata queries
// ============================================================================

/**
 * Get the provider for a project's integration in a specific category.
 */
export async function getIntegrationProvider(
	projectId: string,
	category: string,
): Promise<string | null> {
	const db = getDb();
	const [row] = await db
		.select({ provider: projectIntegrations.provider })
		.from(projectIntegrations)
		.where(
			and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.category, category)),
		);

	return row?.provider ?? null;
}

// ============================================================================
// CRUD for credentials (org-scoped pool)
// ============================================================================

export async function createCredential(params: {
	orgId: string;
	name: string;
	envVarKey: string;
	value: string;
	isDefault?: boolean;
}): Promise<{ id: number }> {
	const db = getDb();
	const [row] = await db
		.insert(credentials)
		.values({
			orgId: params.orgId,
			name: params.name,
			envVarKey: params.envVarKey,
			value: encryptCredential(params.value, params.orgId),
			isDefault: params.isDefault ?? false,
		})
		.returning({ id: credentials.id });

	// Sync to project_credentials for all projects in the org when this is a default credential.
	// Default credentials are org-wide — every project should inherit them.
	if (params.isDefault) {
		const orgProjects = await db
			.select({ id: projects.id })
			.from(projects)
			.where(eq(projects.orgId, params.orgId));
		for (const project of orgProjects) {
			await upsertProjectCredential(
				project.id,
				params.envVarKey,
				encryptCredential(params.value, project.id),
				params.name,
			);
		}
	}

	return row;
}

export async function updateCredential(
	id: number,
	updates: {
		name?: string;
		value?: string;
		isDefault?: boolean;
	},
): Promise<void> {
	const db = getDb();
	const setClause: Record<string, unknown> = { updatedAt: new Date() };
	if (updates.name !== undefined) setClause.name = updates.name;
	if (updates.value !== undefined) {
		// Look up orgId for AAD binding
		const [row] = await db
			.select({ orgId: credentials.orgId })
			.from(credentials)
			.where(eq(credentials.id, id));
		if (row) {
			setClause.value = encryptCredential(updates.value, row.orgId);
		} else {
			setClause.value = updates.value;
		}
	}
	if (updates.isDefault !== undefined) setClause.isDefault = updates.isDefault;

	await db.update(credentials).set(setClause).where(eq(credentials.id, id));
}

export async function deleteCredential(id: number): Promise<void> {
	const db = getDb();
	await db.delete(credentials).where(eq(credentials.id, id));
}

export async function listOrgCredentials(
	orgId: string,
): Promise<(typeof credentials.$inferSelect)[]> {
	const db = getDb();
	const rows = await db.select().from(credentials).where(eq(credentials.orgId, orgId));
	return rows.map((row) => ({ ...row, value: decryptCredential(row.value, orgId) }));
}

export async function findCredentialIdByEnvVarKey(
	orgId: string,
	envVarKey: string,
): Promise<number | null> {
	const db = getDb();
	const [row] = await db
		.select({ id: credentials.id })
		.from(credentials)
		.where(
			and(
				eq(credentials.orgId, orgId),
				eq(credentials.envVarKey, envVarKey),
				eq(credentials.isDefault, true),
			),
		);
	return row?.id ?? null;
}

import { and, eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { decryptCredential, encryptCredential } from '../crypto.js';
import { credentials, integrationCredentials, projectIntegrations } from '../schema/index.js';

// ============================================================================
// Integration credential resolution
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

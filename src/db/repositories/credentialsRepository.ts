import { and, eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { credentials, projectCredentialOverrides } from '../schema/index.js';

/**
 * Resolve a single credential for a project.
 * Resolution order:
 *   1. Project-level override (project_credential_overrides → credentials.value)
 *   2. Org-level default (credentials WHERE org_id AND env_var_key AND is_default)
 *   3. null
 */
export async function resolveCredential(
	projectId: string,
	orgId: string,
	envVarKey: string,
): Promise<string | null> {
	const db = getDb();

	// 1. Check project override
	const [override] = await db
		.select({ value: credentials.value })
		.from(projectCredentialOverrides)
		.innerJoin(credentials, eq(projectCredentialOverrides.credentialId, credentials.id))
		.where(
			and(
				eq(projectCredentialOverrides.projectId, projectId),
				eq(projectCredentialOverrides.envVarKey, envVarKey),
			),
		);
	if (override) return override.value;

	// 2. Check org default
	const [orgDefault] = await db
		.select({ value: credentials.value })
		.from(credentials)
		.where(
			and(
				eq(credentials.orgId, orgId),
				eq(credentials.envVarKey, envVarKey),
				eq(credentials.isDefault, true),
			),
		);
	if (orgDefault) return orgDefault.value;

	return null;
}

/**
 * Resolve all credentials for a project as a key-value map.
 * Merges org defaults with project overrides (overrides win).
 */
export async function resolveAllCredentials(
	projectId: string,
	orgId: string,
): Promise<Record<string, string>> {
	const db = getDb();
	const result: Record<string, string> = {};

	// Load org defaults
	const orgDefaults = await db
		.select({ envVarKey: credentials.envVarKey, value: credentials.value })
		.from(credentials)
		.where(and(eq(credentials.orgId, orgId), eq(credentials.isDefault, true)));

	for (const row of orgDefaults) {
		result[row.envVarKey] = row.value;
	}

	// Load project overrides (overwrite org defaults)
	const overrides = await db
		.select({
			envVarKey: projectCredentialOverrides.envVarKey,
			value: credentials.value,
		})
		.from(projectCredentialOverrides)
		.innerJoin(credentials, eq(projectCredentialOverrides.credentialId, credentials.id))
		.where(eq(projectCredentialOverrides.projectId, projectId));

	for (const row of overrides) {
		result[row.envVarKey] = row.value;
	}

	return result;
}

// --- CRUD for credentials ---

export async function createCredential(params: {
	orgId: string;
	name: string;
	envVarKey: string;
	value: string;
	description?: string;
	isDefault?: boolean;
}): Promise<{ id: number }> {
	const db = getDb();
	const [row] = await db
		.insert(credentials)
		.values({
			orgId: params.orgId,
			name: params.name,
			envVarKey: params.envVarKey,
			value: params.value,
			description: params.description,
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
		description?: string;
		isDefault?: boolean;
	},
): Promise<void> {
	const db = getDb();
	const setClause: Record<string, unknown> = { updatedAt: new Date() };
	if (updates.name !== undefined) setClause.name = updates.name;
	if (updates.value !== undefined) setClause.value = updates.value;
	if (updates.description !== undefined) setClause.description = updates.description;
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
	return db.select().from(credentials).where(eq(credentials.orgId, orgId));
}

// --- Override management ---

export async function setProjectCredentialOverride(
	projectId: string,
	envVarKey: string,
	credentialId: number,
): Promise<void> {
	const db = getDb();
	await db
		.insert(projectCredentialOverrides)
		.values({ projectId, envVarKey, credentialId })
		.onConflictDoUpdate({
			target: [projectCredentialOverrides.projectId, projectCredentialOverrides.envVarKey],
			set: { credentialId, updatedAt: new Date() },
		});
}

export async function removeProjectCredentialOverride(
	projectId: string,
	envVarKey: string,
): Promise<void> {
	const db = getDb();
	await db
		.delete(projectCredentialOverrides)
		.where(
			and(
				eq(projectCredentialOverrides.projectId, projectId),
				eq(projectCredentialOverrides.envVarKey, envVarKey),
			),
		);
}

export async function listProjectOverrides(
	projectId: string,
): Promise<{ envVarKey: string; credentialId: number; credentialName: string }[]> {
	const db = getDb();
	const rows = await db
		.select({
			envVarKey: projectCredentialOverrides.envVarKey,
			credentialId: projectCredentialOverrides.credentialId,
			credentialName: credentials.name,
		})
		.from(projectCredentialOverrides)
		.innerJoin(credentials, eq(projectCredentialOverrides.credentialId, credentials.id))
		.where(eq(projectCredentialOverrides.projectId, projectId));
	return rows;
}

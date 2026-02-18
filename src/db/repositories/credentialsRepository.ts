import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../client.js';
import { decryptCredential, encryptCredential } from '../crypto.js';
import { credentials, projectCredentialOverrides } from '../schema/index.js';

/**
 * Resolve a single credential for a project.
 * Resolution order:
 *   1. Project-level override (project_credential_overrides WHERE agent_type IS NULL)
 *   2. Org-level default (credentials WHERE org_id AND env_var_key AND is_default)
 *   3. null
 */
export async function resolveCredential(
	projectId: string,
	orgId: string,
	envVarKey: string,
): Promise<string | null> {
	const db = getDb();

	// 1. Check project override (project-wide, not agent-scoped)
	const [override] = await db
		.select({ value: credentials.value })
		.from(projectCredentialOverrides)
		.innerJoin(credentials, eq(projectCredentialOverrides.credentialId, credentials.id))
		.where(
			and(
				eq(projectCredentialOverrides.projectId, projectId),
				eq(projectCredentialOverrides.envVarKey, envVarKey),
				isNull(projectCredentialOverrides.agentType),
			),
		);
	if (override) return decryptCredential(override.value, orgId);

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
	if (orgDefault) return decryptCredential(orgDefault.value, orgId);

	return null;
}

/**
 * Resolve a credential for a specific agent type and project.
 * Resolution order:
 *   1. Agent+project override (WHERE project_id AND env_var_key AND agent_type)
 *   2. Falls through to resolveCredential() (project override → org default → null)
 */
export async function resolveAgentCredential(
	projectId: string,
	orgId: string,
	agentType: string,
	envVarKey: string,
): Promise<string | null> {
	const db = getDb();

	// 1. Check agent-scoped override
	const [agentOverride] = await db
		.select({ value: credentials.value })
		.from(projectCredentialOverrides)
		.innerJoin(credentials, eq(projectCredentialOverrides.credentialId, credentials.id))
		.where(
			and(
				eq(projectCredentialOverrides.projectId, projectId),
				eq(projectCredentialOverrides.envVarKey, envVarKey),
				eq(projectCredentialOverrides.agentType, agentType),
			),
		);
	if (agentOverride) return decryptCredential(agentOverride.value, orgId);

	// 2. Fall through to project override → org default
	return resolveCredential(projectId, orgId, envVarKey);
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
		result[row.envVarKey] = decryptCredential(row.value, orgId);
	}

	// Load project-wide overrides (overwrite org defaults) — excludes agent-scoped overrides
	const overrides = await db
		.select({
			envVarKey: projectCredentialOverrides.envVarKey,
			value: credentials.value,
		})
		.from(projectCredentialOverrides)
		.innerJoin(credentials, eq(projectCredentialOverrides.credentialId, credentials.id))
		.where(
			and(
				eq(projectCredentialOverrides.projectId, projectId),
				isNull(projectCredentialOverrides.agentType),
			),
		);

	for (const row of overrides) {
		result[row.envVarKey] = decryptCredential(row.value, orgId);
	}

	return result;
}

// --- CRUD for credentials ---

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

// --- Override management (project-wide) ---

export async function setProjectCredentialOverride(
	projectId: string,
	envVarKey: string,
	credentialId: number,
): Promise<void> {
	const db = getDb();
	// Upsert: use raw SQL conflict target for partial index (agent_type IS NULL)
	// Drizzle's onConflictDoUpdate doesn't support WHERE on conflict target,
	// so we delete-then-insert to match the partial unique index.
	await db
		.delete(projectCredentialOverrides)
		.where(
			and(
				eq(projectCredentialOverrides.projectId, projectId),
				eq(projectCredentialOverrides.envVarKey, envVarKey),
				isNull(projectCredentialOverrides.agentType),
			),
		);
	await db
		.insert(projectCredentialOverrides)
		.values({ projectId, envVarKey, credentialId, agentType: null });
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
				isNull(projectCredentialOverrides.agentType),
			),
		);
}

export async function listProjectOverrides(
	projectId: string,
): Promise<
	{ envVarKey: string; credentialId: number; credentialName: string; agentType: string | null }[]
> {
	const db = getDb();
	const rows = await db
		.select({
			envVarKey: projectCredentialOverrides.envVarKey,
			credentialId: projectCredentialOverrides.credentialId,
			credentialName: credentials.name,
			agentType: projectCredentialOverrides.agentType,
		})
		.from(projectCredentialOverrides)
		.innerJoin(credentials, eq(projectCredentialOverrides.credentialId, credentials.id))
		.where(eq(projectCredentialOverrides.projectId, projectId));
	return rows;
}

// --- Override management (agent-scoped) ---

export async function setAgentCredentialOverride(
	projectId: string,
	envVarKey: string,
	agentType: string,
	credentialId: number,
): Promise<void> {
	const db = getDb();
	// Delete-then-insert to match partial unique index (agent_type IS NOT NULL)
	await db
		.delete(projectCredentialOverrides)
		.where(
			and(
				eq(projectCredentialOverrides.projectId, projectId),
				eq(projectCredentialOverrides.envVarKey, envVarKey),
				eq(projectCredentialOverrides.agentType, agentType),
			),
		);
	await db
		.insert(projectCredentialOverrides)
		.values({ projectId, envVarKey, credentialId, agentType });
}

export async function removeAgentCredentialOverride(
	projectId: string,
	envVarKey: string,
	agentType: string,
): Promise<void> {
	const db = getDb();
	await db
		.delete(projectCredentialOverrides)
		.where(
			and(
				eq(projectCredentialOverrides.projectId, projectId),
				eq(projectCredentialOverrides.envVarKey, envVarKey),
				eq(projectCredentialOverrides.agentType, agentType),
			),
		);
}

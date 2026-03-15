import { and, eq } from 'drizzle-orm';
import type { IntegrationProvider } from '../../config/integrationRoles.js';
import { PROVIDER_CREDENTIAL_ROLES } from '../../config/integrationRoles.js';
import { getDb } from '../client.js';
import { reEncryptCredential } from '../crypto.js';
import { credentials, integrationCredentials, projectIntegrations } from '../schema/index.js';
import { deleteProjectCredential, upsertProjectCredential } from './credentialsRepository.js';

function roleToEnvVarKey(provider: string, role: string): string | undefined {
	const roles = PROVIDER_CREDENTIAL_ROLES[provider as IntegrationProvider];
	return roles?.find((r) => r.role === role)?.envVarKey;
}

// ============================================================================
// Project Integrations
// ============================================================================

export async function listProjectIntegrations(projectId: string) {
	const db = getDb();
	return db.select().from(projectIntegrations).where(eq(projectIntegrations.projectId, projectId));
}

export async function getIntegrationByProjectAndCategory(projectId: string, category: string) {
	const db = getDb();
	const [row] = await db
		.select()
		.from(projectIntegrations)
		.where(
			and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.category, category)),
		);
	return row ?? null;
}

export async function upsertProjectIntegration(
	projectId: string,
	category: string,
	provider: string,
	config: Record<string, unknown>,
	triggers?: Record<string, boolean>,
) {
	const db = getDb();
	// Preserve existing triggers if not provided (prevents data loss from Integration tab saves)
	let triggersToSave = triggers;
	if (triggersToSave === undefined) {
		const existing = await getIntegrationByProjectAndCategory(projectId, category);
		triggersToSave = (existing?.triggers as Record<string, boolean>) ?? {};
	}
	const [row] = await db
		.insert(projectIntegrations)
		.values({ projectId, category, provider, config, triggers: triggersToSave })
		.onConflictDoUpdate({
			target: [projectIntegrations.projectId, projectIntegrations.category],
			set: { provider, config, triggers: triggersToSave, updatedAt: new Date() },
		})
		.returning();
	return row;
}

/**
 * Update only the triggers column for an existing integration.
 * Merges the provided triggers with any existing ones (nested keys are merged).
 */
export async function updateProjectIntegrationTriggers(
	projectId: string,
	category: string,
	triggers: Record<string, unknown>,
) {
	const db = getDb();
	const existing = await getIntegrationByProjectAndCategory(projectId, category);
	if (!existing) {
		throw new Error(`No ${category} integration found for project ${projectId}`);
	}
	// Deep-merge triggers: preserve existing top-level keys, merge nested objects
	const existingTriggers = (existing.triggers as Record<string, unknown>) ?? {};
	const merged: Record<string, unknown> = { ...existingTriggers };
	for (const [key, value] of Object.entries(triggers)) {
		if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			// Merge nested object
			const existingChild =
				typeof merged[key] === 'object' && merged[key] !== null
					? (merged[key] as Record<string, unknown>)
					: {};
			merged[key] = { ...existingChild, ...(value as Record<string, unknown>) };
		} else {
			merged[key] = value;
		}
	}
	await db
		.update(projectIntegrations)
		.set({ triggers: merged, updatedAt: new Date() })
		.where(
			and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.category, category)),
		);
}

export async function deleteProjectIntegration(projectId: string, category: string) {
	const db = getDb();
	await db
		.delete(projectIntegrations)
		.where(
			and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.category, category)),
		);
}

// ============================================================================
// Integration Credentials
// ============================================================================

export async function listIntegrationCredentials(integrationId: number) {
	const db = getDb();
	return db
		.select({
			id: integrationCredentials.id,
			role: integrationCredentials.role,
			credentialId: integrationCredentials.credentialId,
			credentialName: credentials.name,
		})
		.from(integrationCredentials)
		.innerJoin(credentials, eq(integrationCredentials.credentialId, credentials.id))
		.where(eq(integrationCredentials.integrationId, integrationId));
}

export async function setIntegrationCredential(
	integrationId: number,
	role: string,
	credentialId: number,
) {
	const db = getDb();
	// Upsert: delete + insert to handle unique constraint
	await db
		.delete(integrationCredentials)
		.where(
			and(
				eq(integrationCredentials.integrationId, integrationId),
				eq(integrationCredentials.role, role),
			),
		);
	await db.insert(integrationCredentials).values({ integrationId, role, credentialId });

	// Sync to project_credentials
	const [integration] = await db
		.select({ projectId: projectIntegrations.projectId, provider: projectIntegrations.provider })
		.from(projectIntegrations)
		.where(eq(projectIntegrations.id, integrationId));
	const envVarKey = integration ? roleToEnvVarKey(integration.provider, role) : undefined;
	if (integration && envVarKey) {
		const [cred] = await db
			.select({ value: credentials.value, orgId: credentials.orgId, name: credentials.name })
			.from(credentials)
			.where(eq(credentials.id, credentialId));
		if (cred) {
			const valueForProject = reEncryptCredential(cred.value, cred.orgId, integration.projectId);
			await upsertProjectCredential(integration.projectId, envVarKey, valueForProject, cred.name);
		}
	}
}

export async function removeIntegrationCredential(integrationId: number, role: string) {
	const db = getDb();

	// Look up project info before deleting (for project_credentials cleanup)
	const [integration] = await db
		.select({ projectId: projectIntegrations.projectId, provider: projectIntegrations.provider })
		.from(projectIntegrations)
		.where(eq(projectIntegrations.id, integrationId));

	await db
		.delete(integrationCredentials)
		.where(
			and(
				eq(integrationCredentials.integrationId, integrationId),
				eq(integrationCredentials.role, role),
			),
		);

	// Remove from project_credentials
	if (integration) {
		const envVarKey = roleToEnvVarKey(integration.provider, role);
		if (envVarKey) {
			await deleteProjectCredential(integration.projectId, envVarKey);
		}
	}
}

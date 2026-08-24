import { and, eq, sql } from 'drizzle-orm';
import type { IntegrationProvider } from '../../config/integrationRoles.js';
import { PROVIDER_CREDENTIAL_ROLES } from '../../config/integrationRoles.js';
import { assertJiraTopologyValid } from '../../integrations/pm/_shared/topology-validation.js';
import { getDb } from '../client.js';
import { projectIntegrations } from '../schema/index.js';
import { deleteProjectCredential } from './credentialsRepository.js';

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

	// Spec 024: reject a JIRA topology the router could not resolve, BEFORE the
	// write, so the operator sees it while the wizard is still open.
	//
	// Throwing a TRPCError from the repository layer is a deliberate layering
	// exception. The honest reason is file ownership: the check belongs in the
	// projects tRPC router, which spec 024 plan 4 owns, and putting it there
	// would have made plans 2 and 4 conflict. The only caller today is that
	// router's upsert mutation, so nothing non-tRPC sees a TRPCError. Move this
	// up a layer once plan 4 lands.
	if (category === 'pm' && provider === 'jira') {
		const projectKey = (config as { projectKey?: unknown }).projectKey;
		if (typeof projectKey === 'string' && projectKey.length > 0) {
			const siblings = await db
				.select({ projectId: projectIntegrations.projectId, config: projectIntegrations.config })
				.from(projectIntegrations)
				// Includes the project itself: the validator needs to know whether it
				// already claims this key, since an existing claimant is not the one
				// creating the conflict (it predates the save).
				.where(
					and(
						eq(projectIntegrations.category, 'pm'),
						eq(projectIntegrations.provider, 'jira'),
						sql`${projectIntegrations.config}->>'projectKey' = ${projectKey}`,
					),
				);
			assertJiraTopologyValid(projectId, config, siblings);
		}
	}

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

// Note: The legacy integration_credentials and credentials tables have been removed.
// Integration credentials are now managed directly via project_credentials.
// Use writeProjectCredential / deleteProjectCredential / listProjectCredentials instead.

/**
 * Remove a project credential by integration role.
 * Maps the role to its env var key for the provider and deletes from project_credentials.
 */
export async function removeIntegrationCredential(integrationId: number, role: string) {
	const db = getDb();

	// Look up project info
	const [integration] = await db
		.select({ projectId: projectIntegrations.projectId, provider: projectIntegrations.provider })
		.from(projectIntegrations)
		.where(eq(projectIntegrations.id, integrationId));

	if (integration) {
		const envVarKey = roleToEnvVarKey(integration.provider, role);
		if (envVarKey) {
			await deleteProjectCredential(integration.projectId, envVarKey);
		}
	}
}

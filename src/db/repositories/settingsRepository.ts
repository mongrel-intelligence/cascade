import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../client.js';
import {
	agentConfigs,
	cascadeDefaults,
	credentials,
	integrationCredentials,
	organizations,
	projectIntegrations,
	projects,
} from '../schema/index.js';

// ============================================================================
// Organizations
// ============================================================================

export async function getOrganization(orgId: string) {
	const db = getDb();
	const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId));
	return row ?? null;
}

export async function updateOrganization(orgId: string, data: { name: string }) {
	const db = getDb();
	await db.update(organizations).set({ name: data.name }).where(eq(organizations.id, orgId));
}

export async function listAllOrganizations() {
	const db = getDb();
	return db.select({ id: organizations.id, name: organizations.name }).from(organizations);
}

// ============================================================================
// Cascade Defaults
// ============================================================================

export async function getCascadeDefaults(orgId: string) {
	const db = getDb();
	const [row] = await db.select().from(cascadeDefaults).where(eq(cascadeDefaults.orgId, orgId));
	return row ?? null;
}

export async function upsertCascadeDefaults(
	orgId: string,
	data: {
		model?: string | null;
		maxIterations?: number | null;
		watchdogTimeoutMs?: number | null;
		cardBudgetUsd?: string | null;
		agentBackend?: string | null;
		progressModel?: string | null;
		progressIntervalMinutes?: string | null;
	},
) {
	const db = getDb();
	const existing = await getCascadeDefaults(orgId);
	if (existing) {
		await db
			.update(cascadeDefaults)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(cascadeDefaults.orgId, orgId));
	} else {
		await db.insert(cascadeDefaults).values({ orgId, ...data });
	}
}

// ============================================================================
// Projects (full CRUD)
// ============================================================================

export async function listProjectsFull(orgId: string) {
	const db = getDb();
	return db.select().from(projects).where(eq(projects.orgId, orgId));
}

export async function getProjectFull(projectId: string, orgId: string) {
	const db = getDb();
	const [row] = await db
		.select()
		.from(projects)
		.where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));
	return row ?? null;
}

export async function createProject(
	orgId: string,
	data: {
		id: string;
		name: string;
		repo?: string;
		baseBranch?: string;
		branchPrefix?: string;
		model?: string | null;
		cardBudgetUsd?: string | null;
		agentBackend?: string | null;
		subscriptionCostZero?: boolean;
	},
) {
	const db = getDb();
	const [row] = await db
		.insert(projects)
		.values({
			id: data.id,
			orgId,
			name: data.name,
			repo: data.repo ?? null,
			baseBranch: data.baseBranch ?? 'main',
			branchPrefix: data.branchPrefix ?? 'feature/',
			model: data.model,
			cardBudgetUsd: data.cardBudgetUsd,
			agentBackend: data.agentBackend,
			subscriptionCostZero: data.subscriptionCostZero ?? false,
		})
		.returning();
	return row;
}

export async function updateProject(
	projectId: string,
	orgId: string,
	updates: {
		name?: string;
		repo?: string;
		baseBranch?: string;
		branchPrefix?: string;
		model?: string | null;
		cardBudgetUsd?: string | null;
		agentBackend?: string | null;
		subscriptionCostZero?: boolean;
	},
) {
	const db = getDb();
	await db
		.update(projects)
		.set({ ...updates, updatedAt: new Date() })
		.where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));
}

export async function deleteProject(projectId: string, orgId: string) {
	const db = getDb();
	await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));
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
}

export async function removeIntegrationCredential(integrationId: number, role: string) {
	const db = getDb();
	await db
		.delete(integrationCredentials)
		.where(
			and(
				eq(integrationCredentials.integrationId, integrationId),
				eq(integrationCredentials.role, role),
			),
		);
}

// ============================================================================
// Agent Configs
// ============================================================================

export async function listAgentConfigs(filter?: { orgId?: string; projectId?: string }) {
	const db = getDb();
	const conditions = [];

	if (filter?.projectId) {
		conditions.push(eq(agentConfigs.projectId, filter.projectId));
	} else if (filter?.orgId) {
		// Return global (no orgId, no projectId) + org-scoped (orgId set, no projectId)
		conditions.push(isNull(agentConfigs.projectId));
	}

	if (conditions.length > 0) {
		return db
			.select()
			.from(agentConfigs)
			.where(and(...conditions));
	}
	return db.select().from(agentConfigs);
}

export async function createAgentConfig(data: {
	orgId?: string | null;
	projectId?: string | null;
	agentType: string;
	model?: string | null;
	maxIterations?: number | null;
	agentBackend?: string | null;
	prompt?: string | null;
}) {
	const db = getDb();
	const [row] = await db
		.insert(agentConfigs)
		.values({
			orgId: data.orgId ?? null,
			projectId: data.projectId ?? null,
			agentType: data.agentType,
			model: data.model,
			maxIterations: data.maxIterations,
			agentBackend: data.agentBackend,
			prompt: data.prompt,
		})
		.returning({ id: agentConfigs.id });
	return row;
}

export async function updateAgentConfig(
	id: number,
	updates: {
		agentType?: string;
		model?: string | null;
		maxIterations?: number | null;
		agentBackend?: string | null;
		prompt?: string | null;
	},
) {
	const db = getDb();
	await db
		.update(agentConfigs)
		.set({ ...updates, updatedAt: new Date() })
		.where(eq(agentConfigs.id, id));
}

export async function deleteAgentConfig(id: number) {
	const db = getDb();
	await db.delete(agentConfigs).where(eq(agentConfigs.id, id));
}

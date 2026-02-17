import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../client.js';
import {
	agentConfigs,
	cascadeDefaults,
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
		repo: string;
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
			repo: data.repo,
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

export async function upsertProjectIntegration(
	projectId: string,
	type: string,
	config: Record<string, unknown>,
) {
	const db = getDb();
	// Delete then insert to handle the unique constraint
	await db
		.delete(projectIntegrations)
		.where(and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.type, type)));
	await db.insert(projectIntegrations).values({ projectId, type, config });
}

export async function deleteProjectIntegration(projectId: string, type: string) {
	const db = getDb();
	await db
		.delete(projectIntegrations)
		.where(and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.type, type)));
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

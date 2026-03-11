import { and, eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { projects } from '../schema/index.js';

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
		workItemBudgetUsd?: string | null;
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
			workItemBudgetUsd: data.workItemBudgetUsd,
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
		workItemBudgetUsd?: string | null;
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

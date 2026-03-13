import { and, eq, sql } from 'drizzle-orm';
import { type EngineSettings, normalizeEngineSettings } from '../../config/engineSettings.js';
import { getDb } from '../client.js';
import { projects } from '../schema/index.js';

// ============================================================================
// Projects (full CRUD)
// ============================================================================

export async function listProjectsFull(orgId: string) {
	const db = getDb();
	return db.select().from(projects).where(eq(projects.orgId, orgId));
}

export async function listAllProjects() {
	const db = getDb();
	return db.select().from(projects).where(sql`1=1`);
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
		agentEngine?: string | null;
		engineSettings?: EngineSettings | null;
	},
) {
	const db = getDb();
	const { engineSettings, ...rest } = data;
	const [row] = await db
		.insert(projects)
		.values({
			id: rest.id,
			orgId,
			name: rest.name,
			repo: rest.repo ?? null,
			baseBranch: rest.baseBranch ?? 'main',
			branchPrefix: rest.branchPrefix ?? 'feature/',
			model: rest.model,
			workItemBudgetUsd: rest.workItemBudgetUsd,
			agentEngine: rest.agentEngine,
			...(engineSettings !== undefined
				? { agentEngineSettings: normalizeEngineSettings(engineSettings) }
				: {}),
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
		agentEngine?: string | null;
		engineSettings?: EngineSettings | null;
	},
) {
	const db = getDb();
	const { engineSettings, ...rest } = updates;
	await db
		.update(projects)
		.set({
			...rest,
			...(engineSettings !== undefined
				? { agentEngineSettings: normalizeEngineSettings(engineSettings) }
				: {}),
			updatedAt: new Date(),
		})
		.where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));
}

export async function deleteProject(projectId: string, orgId: string) {
	const db = getDb();
	await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));
}

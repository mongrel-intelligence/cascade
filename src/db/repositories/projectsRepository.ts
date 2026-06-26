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
		maxIterations?: number | null;
		watchdogTimeoutMs?: number | null;
		workItemBudgetUsd?: string | null;
		agentEngine?: string | null;
		engineSettings?: EngineSettings | null;
		progressModel?: string | null;
		progressIntervalMinutes?: string | null;
		runLinksEnabled?: boolean;
		maxInFlightItems?: number | null;
		snapshotEnabled?: boolean | null;
		snapshotTtlMs?: number | null;
		workerImage?: string | null;
		workerImageDigest?: string | null;
		workerImageStatus?: string | null;
		workerImageError?: string | null;
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
			maxIterations: rest.maxIterations,
			watchdogTimeoutMs: rest.watchdogTimeoutMs,
			workItemBudgetUsd: rest.workItemBudgetUsd,
			agentEngine: rest.agentEngine,
			progressModel: rest.progressModel,
			progressIntervalMinutes: rest.progressIntervalMinutes,
			runLinksEnabled: rest.runLinksEnabled ?? false,
			maxInFlightItems: rest.maxInFlightItems,
			snapshotEnabled: rest.snapshotEnabled,
			snapshotTtlMs: rest.snapshotTtlMs,
			workerImage: rest.workerImage,
			workerImageDigest: rest.workerImageDigest,
			workerImageStatus: rest.workerImageStatus,
			workerImageError: rest.workerImageError,
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
		maxIterations?: number | null;
		watchdogTimeoutMs?: number | null;
		workItemBudgetUsd?: string | null;
		agentEngine?: string | null;
		engineSettings?: EngineSettings | null;
		progressModel?: string | null;
		progressIntervalMinutes?: string | null;
		runLinksEnabled?: boolean;
		maxInFlightItems?: number | null;
		snapshotEnabled?: boolean | null;
		snapshotTtlMs?: number | null;
		workerImage?: string | null;
		workerImageDigest?: string | null;
		workerImageStatus?: string | null;
		workerImageError?: string | null;
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

/**
 * Record the outcome of a router-side worker-image validation (spec 022 plan 3).
 *
 * Updates the project's `worker_image_*` columns from the `pending` state set by
 * the API mutation. The write is guarded by `worker_image = ref`: it only applies
 * when the project's current operator-set reference still equals the validated
 * `ref`. If the operator re-set or cleared the image after this job was enqueued,
 * the guard matches zero rows and the stale result is dropped (the newer
 * reference owns its own validation job). Returns whether a row was updated.
 *
 *   - `verified` → pins the immutable `digest`, clears `error`.
 *   - `failed`   → records the precise `error`, leaves `digest` null.
 *
 * Org scoping is intentionally absent: the caller is the trusted router consuming
 * a job it enqueued with an internal projectId, not a user request.
 */
export async function recordWorkerImageValidationResult(
	projectId: string,
	ref: string,
	result:
		| { status: 'verified'; digest: string; error: null }
		| { status: 'failed'; digest: null; error: string },
): Promise<boolean> {
	const db = getDb();
	const updated = await db
		.update(projects)
		.set({
			workerImageStatus: result.status,
			workerImageDigest: result.digest,
			workerImageError: result.error,
			updatedAt: new Date(),
		})
		.where(and(eq(projects.id, projectId), eq(projects.workerImage, ref)))
		.returning({ id: projects.id });
	return updated.length > 0;
}

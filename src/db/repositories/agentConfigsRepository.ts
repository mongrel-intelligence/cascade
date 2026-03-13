import { and, eq, isNull, or } from 'drizzle-orm';
import { getDb } from '../client.js';
import { agentConfigs, projects } from '../schema/index.js';

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
		conditions.push(or(eq(agentConfigs.orgId, filter.orgId), isNull(agentConfigs.orgId)));
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

export async function listGlobalAgentConfigs() {
	const db = getDb();
	return db
		.select()
		.from(agentConfigs)
		.where(and(isNull(agentConfigs.orgId), isNull(agentConfigs.projectId)));
}

export async function createAgentConfig(data: {
	orgId?: string | null;
	projectId?: string | null;
	agentType: string;
	model?: string | null;
	maxIterations?: number | null;
	agentEngine?: string | null;
	maxConcurrency?: number | null;
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
			agentEngine: data.agentEngine,
			maxConcurrency: data.maxConcurrency,
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
		agentEngine?: string | null;
		maxConcurrency?: number | null;
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

/**
 * Resolve max_concurrency for a (projectId, agentType) pair.
 * Checks project-scoped config first, then org-scoped config.
 * Returns null if no config with max_concurrency is found (= no limit).
 *
 * Results are cached for 5 seconds to avoid repeated DB queries on
 * sequential webhook batches.
 */
const MAX_CONCURRENCY_TTL_MS = 5_000;
const maxConcurrencyCache = new Map<string, { value: number | null; expiresAt: number }>();

export async function getMaxConcurrency(
	projectId: string,
	agentType: string,
): Promise<number | null> {
	const cacheKey = `${projectId}:${agentType}`;
	const cached = maxConcurrencyCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.value;
	}

	const db = getDb();

	// 1. Project-scoped config
	const [projectConfig] = await db
		.select({ maxConcurrency: agentConfigs.maxConcurrency })
		.from(agentConfigs)
		.where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.agentType, agentType)))
		.limit(1);
	if (projectConfig?.maxConcurrency != null) {
		maxConcurrencyCache.set(cacheKey, {
			value: projectConfig.maxConcurrency,
			expiresAt: Date.now() + MAX_CONCURRENCY_TTL_MS,
		});
		return projectConfig.maxConcurrency;
	}

	// 2. Org-scoped config — need orgId from project
	const [project] = await db
		.select({ orgId: projects.orgId })
		.from(projects)
		.where(eq(projects.id, projectId))
		.limit(1);
	if (!project) {
		maxConcurrencyCache.set(cacheKey, {
			value: null,
			expiresAt: Date.now() + MAX_CONCURRENCY_TTL_MS,
		});
		return null;
	}

	const [orgConfig] = await db
		.select({ maxConcurrency: agentConfigs.maxConcurrency })
		.from(agentConfigs)
		.where(
			and(
				eq(agentConfigs.orgId, project.orgId),
				isNull(agentConfigs.projectId),
				eq(agentConfigs.agentType, agentType),
			),
		)
		.limit(1);

	const result = orgConfig?.maxConcurrency ?? null;
	maxConcurrencyCache.set(cacheKey, {
		value: result,
		expiresAt: Date.now() + MAX_CONCURRENCY_TTL_MS,
	});
	return result;
}

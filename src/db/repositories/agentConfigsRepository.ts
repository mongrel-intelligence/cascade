import { and, eq } from 'drizzle-orm';
import type { EngineSettings } from '../../config/engineSettings.js';
import { getDb } from '../client.js';
import { agentConfigs } from '../schema/index.js';

// ============================================================================
// Agent Configs
// ============================================================================

export async function listAgentConfigs(filter: { projectId: string }) {
	const db = getDb();
	return db.select().from(agentConfigs).where(eq(agentConfigs.projectId, filter.projectId));
}

export async function createAgentConfig(data: {
	projectId: string;
	agentType: string;
	model?: string | null;
	maxIterations?: number | null;
	agentEngine?: string | null;
	engineSettings?: EngineSettings | null;
	maxConcurrency?: number | null;
	systemPrompt?: string | null;
	taskPrompt?: string | null;
}) {
	const db = getDb();
	const [row] = await db
		.insert(agentConfigs)
		.values({
			projectId: data.projectId,
			agentType: data.agentType,
			model: data.model,
			maxIterations: data.maxIterations,
			agentEngine: data.agentEngine,
			agentEngineSettings: data.engineSettings,
			maxConcurrency: data.maxConcurrency,
			systemPrompt: data.systemPrompt,
			taskPrompt: data.taskPrompt,
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
		engineSettings?: EngineSettings | null;
		maxConcurrency?: number | null;
		systemPrompt?: string | null;
		taskPrompt?: string | null;
	},
) {
	const db = getDb();
	const { engineSettings, ...rest } = updates;
	await db
		.update(agentConfigs)
		.set({
			...rest,
			...(engineSettings !== undefined ? { agentEngineSettings: engineSettings } : {}),
			updatedAt: new Date(),
		})
		.where(eq(agentConfigs.id, id));
}

export async function deleteAgentConfig(id: number) {
	const db = getDb();
	await db.delete(agentConfigs).where(eq(agentConfigs.id, id));
}

/**
 * Resolve system_prompt and task_prompt for a (projectId, agentType) pair.
 * Returns null for each field if no project-scoped config with that prompt is found.
 *
 * Results are cached for 5 seconds to avoid repeated DB queries on
 * sequential webhook batches.
 */
const AGENT_CONFIG_PROMPTS_TTL_MS = 5_000;
const agentConfigPromptsCache = new Map<
	string,
	{ value: { systemPrompt: string | null; taskPrompt: string | null }; expiresAt: number }
>();

export async function getAgentConfigPrompts(
	projectId: string,
	agentType: string,
): Promise<{ systemPrompt: string | null; taskPrompt: string | null }> {
	const cacheKey = `${projectId}:${agentType}`;
	const cached = agentConfigPromptsCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.value;
	}

	const db = getDb();

	const [projectConfig] = await db
		.select({
			systemPrompt: agentConfigs.systemPrompt,
			taskPrompt: agentConfigs.taskPrompt,
		})
		.from(agentConfigs)
		.where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.agentType, agentType)))
		.limit(1);

	const result = {
		systemPrompt: projectConfig?.systemPrompt ?? null,
		taskPrompt: projectConfig?.taskPrompt ?? null,
	};
	agentConfigPromptsCache.set(cacheKey, {
		value: result,
		expiresAt: Date.now() + AGENT_CONFIG_PROMPTS_TTL_MS,
	});
	return result;
}

/**
 * Check whether an agent is explicitly enabled for a project.
 * An agent is enabled if and only if it has a row in `agent_configs` for that project.
 * The `debug` agent is always considered enabled (internal infrastructure).
 *
 * Results are cached for 5 seconds to avoid repeated DB queries on
 * sequential webhook batches.
 */
const AGENT_ENABLED_TTL_MS = 5_000;
const agentEnabledCache = new Map<string, { value: boolean; expiresAt: number }>();

export async function isAgentEnabledForProject(
	projectId: string,
	agentType: string,
): Promise<boolean> {
	// Debug agent is always enabled — internal infrastructure agent
	if (agentType === 'debug') {
		return true;
	}

	const cacheKey = `${projectId}:${agentType}`;
	const cached = agentEnabledCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.value;
	}

	const db = getDb();

	const [row] = await db
		.select({ id: agentConfigs.id })
		.from(agentConfigs)
		.where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.agentType, agentType)))
		.limit(1);

	const result = row !== undefined;
	agentEnabledCache.set(cacheKey, {
		value: result,
		expiresAt: Date.now() + AGENT_ENABLED_TTL_MS,
	});
	return result;
}

/**
 * Resolve max_concurrency for a (projectId, agentType) pair.
 * Returns null if no project-scoped config with max_concurrency is found (= no limit).
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

	const [projectConfig] = await db
		.select({ maxConcurrency: agentConfigs.maxConcurrency })
		.from(agentConfigs)
		.where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.agentType, agentType)))
		.limit(1);

	const result = projectConfig?.maxConcurrency ?? null;
	maxConcurrencyCache.set(cacheKey, {
		value: result,
		expiresAt: Date.now() + MAX_CONCURRENCY_TTL_MS,
	});
	return result;
}

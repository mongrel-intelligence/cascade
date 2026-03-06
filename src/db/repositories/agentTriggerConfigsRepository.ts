import { and, eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { agentTriggerConfigs } from '../schema/index.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentTriggerConfig {
	id: number;
	projectId: string;
	agentType: string;
	triggerEvent: string;
	enabled: boolean;
	parameters: Record<string, unknown>;
	createdAt: Date | null;
	updatedAt: Date | null;
}

export interface CreateTriggerConfigInput {
	projectId: string;
	agentType: string;
	triggerEvent: string;
	enabled?: boolean;
	parameters?: Record<string, unknown>;
}

export interface UpdateTriggerConfigInput {
	enabled?: boolean;
	parameters?: Record<string, unknown>;
}

// ============================================================================
// Repository Functions
// ============================================================================

/**
 * Get a specific trigger config by ID.
 */
export async function getTriggerConfigById(id: number): Promise<AgentTriggerConfig | null> {
	const db = getDb();
	const [row] = await db.select().from(agentTriggerConfigs).where(eq(agentTriggerConfigs.id, id));
	return row ? mapRowToConfig(row) : null;
}

/**
 * Get a specific trigger config by project, agent type, and trigger event.
 */
export async function getTriggerConfig(
	projectId: string,
	agentType: string,
	triggerEvent: string,
): Promise<AgentTriggerConfig | null> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(agentTriggerConfigs)
		.where(
			and(
				eq(agentTriggerConfigs.projectId, projectId),
				eq(agentTriggerConfigs.agentType, agentType),
				eq(agentTriggerConfigs.triggerEvent, triggerEvent),
			),
		);
	return row ? mapRowToConfig(row) : null;
}

/**
 * Get all trigger configs for a project.
 */
export async function getTriggerConfigsByProject(projectId: string): Promise<AgentTriggerConfig[]> {
	const db = getDb();
	const rows = await db
		.select()
		.from(agentTriggerConfigs)
		.where(eq(agentTriggerConfigs.projectId, projectId));
	return rows.map(mapRowToConfig);
}

/**
 * Get all trigger configs for a specific agent in a project.
 */
export async function getTriggerConfigsByProjectAndAgent(
	projectId: string,
	agentType: string,
): Promise<AgentTriggerConfig[]> {
	const db = getDb();
	const rows = await db
		.select()
		.from(agentTriggerConfigs)
		.where(
			and(
				eq(agentTriggerConfigs.projectId, projectId),
				eq(agentTriggerConfigs.agentType, agentType),
			),
		);
	return rows.map(mapRowToConfig);
}

/**
 * Create or update a trigger config (upsert).
 */
export async function upsertTriggerConfig(
	input: CreateTriggerConfigInput,
): Promise<AgentTriggerConfig> {
	const db = getDb();
	const [row] = await db
		.insert(agentTriggerConfigs)
		.values({
			projectId: input.projectId,
			agentType: input.agentType,
			triggerEvent: input.triggerEvent,
			enabled: input.enabled ?? true,
			parameters: input.parameters ?? {},
		})
		.onConflictDoUpdate({
			target: [
				agentTriggerConfigs.projectId,
				agentTriggerConfigs.agentType,
				agentTriggerConfigs.triggerEvent,
			],
			set: {
				enabled: input.enabled ?? true,
				parameters: input.parameters ?? {},
				updatedAt: new Date(),
			},
		})
		.returning();
	return mapRowToConfig(row);
}

/**
 * Update an existing trigger config by ID.
 */
export async function updateTriggerConfig(
	id: number,
	input: UpdateTriggerConfigInput,
): Promise<AgentTriggerConfig | null> {
	const db = getDb();
	const [row] = await db
		.update(agentTriggerConfigs)
		.set({
			...(input.enabled !== undefined && { enabled: input.enabled }),
			...(input.parameters !== undefined && { parameters: input.parameters }),
			updatedAt: new Date(),
		})
		.where(eq(agentTriggerConfigs.id, id))
		.returning();
	return row ? mapRowToConfig(row) : null;
}

/**
 * Delete a trigger config by ID.
 */
export async function deleteTriggerConfig(id: number): Promise<boolean> {
	const db = getDb();
	const result = await db.delete(agentTriggerConfigs).where(eq(agentTriggerConfigs.id, id));
	return (result.rowCount ?? 0) > 0;
}

/**
 * Delete all trigger configs for a project.
 */
export async function deleteTriggerConfigsByProject(projectId: string): Promise<number> {
	const db = getDb();
	const result = await db
		.delete(agentTriggerConfigs)
		.where(eq(agentTriggerConfigs.projectId, projectId));
	return result.rowCount ?? 0;
}

/**
 * Bulk upsert trigger configs.
 * Uses individual upserts in a transaction to ensure each config's values are used correctly.
 */
export async function bulkUpsertTriggerConfigs(
	configs: CreateTriggerConfigInput[],
): Promise<AgentTriggerConfig[]> {
	if (configs.length === 0) return [];

	const db = getDb();
	const results: AgentTriggerConfig[] = [];

	await db.transaction(async (tx) => {
		for (const config of configs) {
			const [row] = await tx
				.insert(agentTriggerConfigs)
				.values({
					projectId: config.projectId,
					agentType: config.agentType,
					triggerEvent: config.triggerEvent,
					enabled: config.enabled ?? true,
					parameters: config.parameters ?? {},
				})
				.onConflictDoUpdate({
					target: [
						agentTriggerConfigs.projectId,
						agentTriggerConfigs.agentType,
						agentTriggerConfigs.triggerEvent,
					],
					set: {
						enabled: config.enabled ?? true,
						parameters: config.parameters ?? {},
						updatedAt: new Date(),
					},
				})
				.returning();
			results.push(mapRowToConfig(row));
		}
	});

	return results;
}

// ============================================================================
// Helpers
// ============================================================================

function mapRowToConfig(row: typeof agentTriggerConfigs.$inferSelect): AgentTriggerConfig {
	return {
		id: row.id,
		projectId: row.projectId,
		agentType: row.agentType,
		triggerEvent: row.triggerEvent,
		enabled: row.enabled,
		parameters: (row.parameters ?? {}) as Record<string, unknown>,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

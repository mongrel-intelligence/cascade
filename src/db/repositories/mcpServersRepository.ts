import { and, eq } from 'drizzle-orm';
import type { McpServerConfig } from '../../backends/types.js';
import { getDb } from '../client.js';
import { mcpServers } from '../schema/index.js';

// ============================================================================
// Types
// ============================================================================

export interface McpServerRow {
	id: string;
	projectId: string;
	name: string;
	config: McpServerConfig;
	agentTypes: string[] | null;
	enabled: boolean;
	createdAt: Date | null;
	updatedAt: Date | null;
}

export interface UpsertMcpServerInput {
	id?: string;
	projectId: string;
	name: string;
	config: McpServerConfig;
	agentTypes?: string[] | null;
	enabled?: boolean;
}

// ============================================================================
// Queries
// ============================================================================

/**
 * List all MCP servers for a project.
 */
export async function listMcpServers(projectId: string): Promise<McpServerRow[]> {
	const db = getDb();
	const rows = await db.select().from(mcpServers).where(eq(mcpServers.projectId, projectId));
	return rows.map(rowToRecord);
}

/**
 * Get enabled MCP servers for a specific project and agent type.
 * Returns servers where:
 * - enabled = true
 * - agentTypes is null/empty (available to all), OR agentTypes includes the given agentType
 */
export async function getMcpServersForAgent(
	projectId: string,
	agentType: string,
): Promise<Record<string, McpServerConfig>> {
	const db = getDb();
	const rows = await db
		.select()
		.from(mcpServers)
		.where(and(eq(mcpServers.projectId, projectId), eq(mcpServers.enabled, true)));

	const result: Record<string, McpServerConfig> = {};
	for (const row of rows) {
		const agentTypes = row.agentTypes;
		// Include if no agent type filter, or if this agent type is in the filter list
		if (!agentTypes || agentTypes.length === 0 || agentTypes.includes(agentType)) {
			result[row.name] = row.config as McpServerConfig;
		}
	}
	return result;
}

/**
 * Get a single MCP server by ID.
 */
export async function getMcpServer(id: string): Promise<McpServerRow | null> {
	const db = getDb();
	const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
	return row ? rowToRecord(row) : null;
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create or update an MCP server (upsert by project_id + name).
 */
export async function upsertMcpServer(input: UpsertMcpServerInput): Promise<McpServerRow> {
	const db = getDb();
	const id = input.id ?? crypto.randomUUID();
	const [row] = await db
		.insert(mcpServers)
		.values({
			id,
			projectId: input.projectId,
			name: input.name,
			config: input.config,
			agentTypes: input.agentTypes ?? null,
			enabled: input.enabled ?? true,
		})
		.onConflictDoUpdate({
			target: [mcpServers.projectId, mcpServers.name],
			set: {
				config: input.config,
				agentTypes: input.agentTypes ?? null,
				enabled: input.enabled ?? true,
				updatedAt: new Date(),
			},
		})
		.returning();
	return rowToRecord(row);
}

/**
 * Delete an MCP server by ID.
 */
export async function deleteMcpServer(id: string): Promise<void> {
	const db = getDb();
	await db.delete(mcpServers).where(eq(mcpServers.id, id));
}

/**
 * Toggle the enabled state of an MCP server.
 */
export async function toggleMcpServer(id: string, enabled: boolean): Promise<McpServerRow | null> {
	const db = getDb();
	const [row] = await db
		.update(mcpServers)
		.set({ enabled, updatedAt: new Date() })
		.where(eq(mcpServers.id, id))
		.returning();
	return row ? rowToRecord(row) : null;
}

// ============================================================================
// Helpers
// ============================================================================

function rowToRecord(row: typeof mcpServers.$inferSelect): McpServerRow {
	return {
		id: row.id,
		projectId: row.projectId,
		name: row.name,
		config: row.config as McpServerConfig,
		agentTypes: row.agentTypes ?? null,
		enabled: row.enabled,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { projects } from './projects.js';

/**
 * MCP server configurations scoped to a project.
 *
 * Each row stores a named MCP server with its transport config (stdio, SSE, or HTTP).
 * The `config` column holds the full McpServerConfig JSON (type + transport fields).
 * The `agentTypes` column optionally restricts which agent types can use the server;
 * null/empty means all agent types.
 */
export const mcpServers = pgTable('mcp_servers', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => projects.id, { onDelete: 'cascade' }),
	/** Human-readable name for the MCP server (unique within a project) */
	name: text('name').notNull(),
	/** Full transport config: { type: 'stdio' | 'sse' | 'http', ... } */
	config: jsonb('config').notNull(),
	/**
	 * Agent types this server is restricted to.
	 * null or empty array means available to all agent types.
	 */
	agentTypes: text('agent_types').array(),
	/** Whether this server is active and should be passed to the backend */
	enabled: boolean('enabled').notNull().default(true),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date()),
});

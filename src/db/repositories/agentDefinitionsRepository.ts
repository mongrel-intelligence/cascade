import { eq } from 'drizzle-orm';
import type { AgentDefinition } from '../../agents/definitions/schema.js';
import { AgentDefinitionSchema } from '../../agents/definitions/schema.js';
import { getDb } from '../client.js';
import { agentDefinitions } from '../schema/index.js';

// ============================================================================
// Agent Definitions
// ============================================================================

export async function getAgentDefinition(agentType: string): Promise<AgentDefinition | null> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(agentDefinitions)
		.where(eq(agentDefinitions.agentType, agentType));
	if (!row) return null;
	return AgentDefinitionSchema.parse(row.definition);
}

export async function listAgentDefinitions(): Promise<
	Array<{ agentType: string; definition: AgentDefinition; isBuiltin: boolean }>
> {
	const db = getDb();
	const rows = await db.select().from(agentDefinitions);
	return rows.map((row) => ({
		agentType: row.agentType,
		definition: AgentDefinitionSchema.parse(row.definition),
		isBuiltin: row.isBuiltin ?? false,
	}));
}

export async function upsertAgentDefinition(
	agentType: string,
	definition: AgentDefinition,
	isBuiltin = false,
): Promise<void> {
	const validated = AgentDefinitionSchema.parse(definition);
	const db = getDb();
	await db
		.insert(agentDefinitions)
		.values({ agentType, definition: validated, isBuiltin })
		.onConflictDoUpdate({
			target: agentDefinitions.agentType,
			set: { definition: validated, isBuiltin, updatedAt: new Date() },
		});
}

export async function deleteAgentDefinition(agentType: string): Promise<void> {
	const db = getDb();
	await db.delete(agentDefinitions).where(eq(agentDefinitions.agentType, agentType));
}

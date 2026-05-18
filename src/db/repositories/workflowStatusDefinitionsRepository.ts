import { asc, eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { workflowStatusDefinitions } from '../schema/index.js';

export interface CustomWorkflowStatusDefinition {
	id: number;
	key: string;
	label: string;
	agentType: string | null;
	sortOrder: number;
	createdAt: Date | null;
	updatedAt: Date | null;
}

export interface CreateWorkflowStatusDefinitionInput {
	key: string;
	label: string;
	agentType?: string | null;
	sortOrder?: number;
}

export interface UpdateWorkflowStatusDefinitionInput {
	label?: string;
	agentType?: string | null;
	sortOrder?: number;
}

export async function listCustomWorkflowStatusDefinitions(): Promise<
	CustomWorkflowStatusDefinition[]
> {
	const db = getDb();
	const rows = await db
		.select()
		.from(workflowStatusDefinitions)
		.orderBy(asc(workflowStatusDefinitions.sortOrder), asc(workflowStatusDefinitions.statusKey));
	return rows.map(mapRow);
}

export async function getCustomWorkflowStatusDefinition(
	key: string,
): Promise<CustomWorkflowStatusDefinition | null> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(workflowStatusDefinitions)
		.where(eq(workflowStatusDefinitions.statusKey, key));
	return row ? mapRow(row) : null;
}

export async function createCustomWorkflowStatusDefinition(
	input: CreateWorkflowStatusDefinitionInput,
): Promise<CustomWorkflowStatusDefinition> {
	const db = getDb();
	const [row] = await db
		.insert(workflowStatusDefinitions)
		.values({
			statusKey: input.key,
			label: input.label,
			agentType: input.agentType ?? null,
			sortOrder: input.sortOrder ?? 1000,
		})
		.returning();
	return mapRow(row);
}

export async function updateCustomWorkflowStatusDefinition(
	key: string,
	input: UpdateWorkflowStatusDefinitionInput,
): Promise<CustomWorkflowStatusDefinition | null> {
	const db = getDb();
	const [row] = await db
		.update(workflowStatusDefinitions)
		.set({
			...(input.label !== undefined ? { label: input.label } : {}),
			...(input.agentType !== undefined ? { agentType: input.agentType } : {}),
			...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
			updatedAt: new Date(),
		})
		.where(eq(workflowStatusDefinitions.statusKey, key))
		.returning();
	return row ? mapRow(row) : null;
}

export async function deleteCustomWorkflowStatusDefinition(key: string): Promise<boolean> {
	const db = getDb();
	const result = await db
		.delete(workflowStatusDefinitions)
		.where(eq(workflowStatusDefinitions.statusKey, key));
	return (result.rowCount ?? 0) > 0;
}

export async function clearAgentTypeReferences(agentType: string): Promise<number> {
	const db = getDb();
	const result = await db
		.update(workflowStatusDefinitions)
		.set({ agentType: null })
		.where(eq(workflowStatusDefinitions.agentType, agentType));
	return result.rowCount ?? 0;
}

function mapRow(
	row: typeof workflowStatusDefinitions.$inferSelect,
): CustomWorkflowStatusDefinition {
	return {
		id: row.id,
		key: row.statusKey,
		label: row.label,
		agentType: row.agentType,
		sortOrder: row.sortOrder,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

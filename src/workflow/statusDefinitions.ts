import {
	getCustomWorkflowStatusDefinition,
	listCustomWorkflowStatusDefinitions,
} from '../db/repositories/workflowStatusDefinitionsRepository.js';

export interface WorkflowStatusDefinition {
	key: string;
	label: string;
	agentType: string | null;
	sortOrder: number;
	isBuiltin: boolean;
}

export const BUILTIN_WORKFLOW_STATUSES: readonly WorkflowStatusDefinition[] = [
	{
		key: 'backlog',
		label: 'Backlog',
		agentType: 'backlog-manager',
		sortOrder: 10,
		isBuiltin: true,
	},
	{ key: 'splitting', label: 'Splitting', agentType: 'splitting', sortOrder: 20, isBuiltin: true },
	{ key: 'planning', label: 'Planning', agentType: 'planning', sortOrder: 30, isBuiltin: true },
	{ key: 'todo', label: 'Todo', agentType: 'implementation', sortOrder: 40, isBuiltin: true },
	{ key: 'inProgress', label: 'In Progress', agentType: null, sortOrder: 50, isBuiltin: true },
	{ key: 'inReview', label: 'In Review', agentType: null, sortOrder: 60, isBuiltin: true },
	{ key: 'done', label: 'Done', agentType: null, sortOrder: 70, isBuiltin: true },
	{ key: 'merged', label: 'Merged', agentType: null, sortOrder: 80, isBuiltin: true },
	{ key: 'alerts', label: 'Alerts', agentType: null, sortOrder: 90, isBuiltin: true },
	{ key: 'friction', label: 'Friction', agentType: null, sortOrder: 100, isBuiltin: true },
] as const;

export const BUILTIN_WORKFLOW_STATUS_KEYS = new Set(
	BUILTIN_WORKFLOW_STATUSES.map((status) => status.key),
);

export function getBuiltinWorkflowStatusDefinition(
	key: string,
): WorkflowStatusDefinition | undefined {
	return BUILTIN_WORKFLOW_STATUSES.find((status) => status.key === key);
}

export async function listWorkflowStatusDefinitions(): Promise<WorkflowStatusDefinition[]> {
	const custom = await listCustomWorkflowStatusDefinitions();
	const customDefinitions = custom
		.filter((status) => !BUILTIN_WORKFLOW_STATUS_KEYS.has(status.key))
		.map((status) => ({
			key: status.key,
			label: status.label,
			agentType: status.agentType,
			sortOrder: status.sortOrder,
			isBuiltin: false,
		}));

	return [...BUILTIN_WORKFLOW_STATUSES, ...customDefinitions];
}

export async function resolveWorkflowStatusDefinition(
	key: string,
): Promise<WorkflowStatusDefinition | undefined> {
	const builtin = getBuiltinWorkflowStatusDefinition(key);
	if (builtin) return builtin;

	const custom = await getCustomWorkflowStatusDefinition(key);
	if (!custom) return undefined;

	return {
		key: custom.key,
		label: custom.label,
		agentType: custom.agentType,
		sortOrder: custom.sortOrder,
		isBuiltin: false,
	};
}

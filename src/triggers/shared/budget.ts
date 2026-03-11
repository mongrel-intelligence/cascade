import { getCostFieldId } from '../../pm/config.js';
import { getPMProvider } from '../../pm/index.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';

export interface BudgetCheckResult {
	exceeded: boolean;
	currentCost: number;
	budget: number;
	remaining: number;
}

/**
 * Resolve the work item budget for a project.
 * Returns `null` if no cost custom field is configured (budget enforcement not applicable).
 */
export function resolveWorkItemBudget(
	project: ProjectConfig,
	config: CascadeConfig,
): number | null {
	const costFieldId = getCostFieldId(project);
	if (!costFieldId) return null;

	return project.workItemBudgetUsd ?? config.defaults.workItemBudgetUsd;
}

/**
 * Read the accumulated cost from a work item's custom field.
 * Returns 0 if no value set yet.
 */
export async function getWorkItemAccumulatedCost(
	workItemId: string,
	project: ProjectConfig,
): Promise<number> {
	const costFieldId = getCostFieldId(project);
	if (!costFieldId) return 0;

	const provider = getPMProvider();
	return provider.getCustomFieldNumber(workItemId, costFieldId);
}

/**
 * Check if a work item has exceeded its budget.
 * Returns `null` if budget enforcement is not applicable (no cost field or no workItemId).
 */
export async function checkBudgetExceeded(
	workItemId: string,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<BudgetCheckResult | null> {
	const budget = resolveWorkItemBudget(project, config);
	if (budget === null) return null;

	const currentCost = await getWorkItemAccumulatedCost(workItemId, project);
	const exceeded = currentCost >= budget;

	return {
		exceeded,
		currentCost,
		budget,
		remaining: exceeded ? 0 : Math.round((budget - currentCost) * 10000) / 10000,
	};
}

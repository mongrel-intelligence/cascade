import { trelloClient } from '../../trello/client.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';

export interface BudgetCheckResult {
	exceeded: boolean;
	currentCost: number;
	budget: number;
	remaining: number;
}

/**
 * Resolve the card budget for a project.
 * Returns `null` if no cost custom field is configured (budget enforcement not applicable).
 */
export function resolveCardBudget(project: ProjectConfig, config: CascadeConfig): number | null {
	const costFieldId = project.trello?.customFields?.cost;
	if (!costFieldId) return null;

	return project.cardBudgetUsd ?? config.defaults.cardBudgetUsd;
}

/**
 * Read the accumulated cost from a card's custom field.
 * Returns 0 if no value set yet.
 */
export async function getCardAccumulatedCost(
	cardId: string,
	project: ProjectConfig,
): Promise<number> {
	const costFieldId = project.trello?.customFields?.cost;
	if (!costFieldId) return 0;

	const items = await trelloClient.getCardCustomFieldItems(cardId);
	const currentItem = items.find((i) => i.idCustomField === costFieldId);
	return Number.parseFloat(currentItem?.value?.number ?? '0');
}

/**
 * Check if a card has exceeded its budget.
 * Returns `null` if budget enforcement is not applicable (no cost field or no cardId).
 */
export async function checkBudgetExceeded(
	cardId: string,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<BudgetCheckResult | null> {
	const budget = resolveCardBudget(project, config);
	if (budget === null) return null;

	const currentCost = await getCardAccumulatedCost(cardId, project);
	const exceeded = currentCost >= budget;

	return {
		exceeded,
		currentCost,
		budget,
		remaining: exceeded ? 0 : Math.round((budget - currentCost) * 10000) / 10000,
	};
}

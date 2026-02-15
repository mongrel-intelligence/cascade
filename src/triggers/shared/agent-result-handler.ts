import { trelloClient } from '../../trello/client.js';
import type { AgentResult, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { safeOperation } from '../../utils/safeOperation.js';

/**
 * Update cost custom field on the Trello card.
 * Shared between GitHub and Trello webhook handlers.
 *
 * Logs are now stored in the database (agent_run_logs table) instead of
 * being uploaded as ZIP attachments to Trello cards.
 */
export async function handleAgentResultArtifacts(
	cardId: string,
	_agentType: string,
	agentResult: AgentResult,
	project: ProjectConfig,
): Promise<void> {
	// Update cost custom field (accumulate with existing)
	const costFieldId = project.trello?.customFields?.cost;
	if (costFieldId && agentResult.cost !== undefined && agentResult.cost > 0) {
		const sessionCost = agentResult.cost;
		await safeOperation(
			async () => {
				const items = await trelloClient.getCardCustomFieldItems(cardId);
				const currentItem = items.find((i) => i.idCustomField === costFieldId);
				const currentCost = Number.parseFloat(currentItem?.value?.number ?? '0');
				const newTotal = Math.round((currentCost + sessionCost) * 10000) / 10000;
				await trelloClient.updateCardCustomFieldNumber(cardId, costFieldId, newTotal);
				logger.info('Updated card cost', {
					cardId,
					sessionCost,
					totalCost: newTotal,
				});
			},
			{ action: 'update cost field' },
		);
	}
}

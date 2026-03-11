import { getCostFieldId } from '../../pm/config.js';
import { getPMProvider } from '../../pm/index.js';
import type { AgentResult, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { safeOperation } from '../../utils/safeOperation.js';

/**
 * Update cost custom field on the work item (card/issue).
 * Shared between GitHub, Trello, and JIRA webhook handlers.
 *
 * Logs are now stored in the database (agent_run_logs table) instead of
 * being uploaded as attachments.
 */
export async function handleAgentResultArtifacts(
	workItemId: string,
	_agentType: string,
	agentResult: AgentResult,
	project: ProjectConfig,
): Promise<void> {
	// Update cost custom field (accumulate with existing)
	const costFieldId = getCostFieldId(project);
	if (costFieldId && agentResult.cost !== undefined && agentResult.cost > 0) {
		const sessionCost = agentResult.cost;
		await safeOperation(
			async () => {
				const provider = getPMProvider();
				const currentCost = await provider.getCustomFieldNumber(workItemId, costFieldId);
				const newTotal = Math.round((currentCost + sessionCost) * 10000) / 10000;
				await provider.updateCustomFieldNumber(workItemId, costFieldId, newTotal);
				logger.info('Updated work item cost', {
					workItemId,
					sessionCost,
					totalCost: newTotal,
				});
			},
			{ action: 'update cost field' },
		);
	}
}

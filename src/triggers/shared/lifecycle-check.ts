/**
 * Helper for checking lifecycle trigger configuration.
 *
 * Lifecycle triggers (prReadyToMerge, prMerged) are stored in the
 * project_integrations.triggers JSONB column under the 'scm' integration,
 * not in the agent_trigger_configs table. They default to disabled.
 */

import { getIntegrationByProjectAndCategory } from '../../db/repositories/integrationsRepository.js';
import { logger } from '../../utils/logging.js';

/**
 * Check whether a lifecycle trigger is enabled for a project.
 * Reads from project_integrations.triggers JSONB for the 'scm' integration.
 * Defaults to false when not configured.
 */
export async function isLifecycleTriggerEnabled(
	projectId: string,
	triggerKey: string,
	handlerName: string,
): Promise<boolean> {
	const integration = await getIntegrationByProjectAndCategory(projectId, 'scm');
	const triggers = (integration?.triggers as Record<string, unknown>) ?? {};
	const enabled = typeof triggers[triggerKey] === 'boolean' ? triggers[triggerKey] : false;

	if (!enabled) {
		logger.info('Lifecycle trigger disabled by config, skipping', {
			handler: handlerName,
			triggerKey,
			projectId,
		});
	}

	return enabled as boolean;
}

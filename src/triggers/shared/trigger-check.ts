/**
 * Shared helper for checking trigger configuration in handler `handle()` methods.
 *
 * Wraps `isTriggerEnabled()` / `getResolvedTriggerConfig()` from config-resolver
 * with consistent logging.
 */

import { logger } from '../../utils/logging.js';
import { getResolvedTriggerConfig, isTriggerEnabled } from '../config-resolver.js';

/**
 * Check whether a trigger is enabled for a project/agent/event combination.
 * Logs an info message when the trigger is disabled, so every skip has a reason.
 */
export async function checkTriggerEnabled(
	projectId: string,
	agentType: string,
	triggerEvent: string,
	handlerName: string,
): Promise<boolean> {
	const enabled = await isTriggerEnabled(projectId, agentType, triggerEvent);
	if (!enabled) {
		logger.info('Trigger disabled by config, skipping', {
			handler: handlerName,
			agentType,
			triggerEvent,
			projectId,
		});
	}
	return enabled;
}

/**
 * Check whether a trigger is enabled AND return its parameters in a single DB call.
 * Use this instead of separate `checkTriggerEnabled` + `getTriggerParameters` calls.
 */
export async function checkTriggerEnabledWithParams(
	projectId: string,
	agentType: string,
	triggerEvent: string,
	handlerName: string,
): Promise<{ enabled: boolean; parameters: Record<string, unknown> }> {
	const config = await getResolvedTriggerConfig(projectId, agentType, triggerEvent);
	if (!config || !config.enabled) {
		logger.info('Trigger disabled by config, skipping', {
			handler: handlerName,
			agentType,
			triggerEvent,
			projectId,
		});
		return { enabled: false, parameters: {} };
	}
	return { enabled: true, parameters: config.parameters };
}

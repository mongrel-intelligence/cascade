/**
 * Shared helper for checking trigger configuration in handler `handle()` methods.
 *
 * Wraps `isTriggerEnabled()` / `getResolvedTriggerConfig()` from config-resolver
 * with consistent logging.
 */

import type { TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { getResolvedTriggerConfig } from '../config-resolver.js';
import { skip } from './skip.js';

export interface TriggerEnablementCheck {
	enabled: boolean;
	parameters: Record<string, unknown>;
	skipResult: TriggerResult | null;
}

const DISABLED_TRIGGER_LOG_MESSAGE = 'Trigger disabled by config, skipping';

function logDisabledTrigger(
	projectId: string,
	agentType: string,
	triggerEvent: string,
	handlerName: string,
) {
	logger.info(DISABLED_TRIGGER_LOG_MESSAGE, {
		handler: handlerName,
		agentType,
		triggerEvent,
		projectId,
	});
}

/**
 * Resolve trigger enablement, merged parameters, and structured disabled-skip
 * output in one config lookup. This is the canonical path for handler gates.
 */
export async function checkTriggerEnablement(
	projectId: string,
	agentType: string,
	triggerEvent: string,
	handlerName: string,
): Promise<TriggerEnablementCheck> {
	const config = await getResolvedTriggerConfig(projectId, agentType, triggerEvent);
	if (!config?.enabled) {
		logDisabledTrigger(projectId, agentType, triggerEvent, handlerName);
		return {
			enabled: false,
			parameters: config?.parameters ?? {},
			skipResult: skip(handlerName, `${agentType} trigger is disabled for this project`),
		};
	}

	return {
		enabled: true,
		parameters: config.parameters,
		skipResult: null,
	};
}

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
	const result = await checkTriggerEnablement(projectId, agentType, triggerEvent, handlerName);
	return result.enabled;
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
	const result = await checkTriggerEnablement(projectId, agentType, triggerEvent, handlerName);
	if (!result.enabled) {
		return { enabled: false, parameters: {} };
	}
	return { enabled: true, parameters: result.parameters };
}

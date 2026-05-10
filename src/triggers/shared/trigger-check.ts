/**
 * Shared helper for checking trigger configuration in handler `handle()` methods.
 *
 * Wraps `isTriggerEnabled()` / `getResolvedTriggerConfig()` from config-resolver
 * with consistent logging.
 */

import type { TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { getResolvedTriggerConfig } from '../config-resolver.js';

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
 * Resolve trigger enablement and merged parameters in one config lookup.
 * Canonical path for handler gates.
 *
 * **Disabled-at-config returns `skipResult: null`, NOT a structured skip.**
 * The registry's `dispatch` loop is first-match-wins on non-null results
 * (see `src/triggers/registry.ts`). A handler whose trigger is disabled is
 * NOT claiming the event — so it returns null and the registry continues
 * to the next matcher. Closes the prod regression on 2026-05-09 where
 * `PROpenedTrigger`'s structured skip on `review trigger is disabled`
 * shadowed `PRConflictDetectedTrigger` for `pull_request: opened` events
 * on `zbigniewsobiecki/ucho` PR #367 (the conflict-resolution agent never
 * fired because review was disabled).
 *
 * The `enabled: false` flag is still returned so callers' explicit branches
 * (`if (!result.enabled) return null;`) keep working unchanged.
 *
 * Operator visibility is preserved via the INFO-level
 * `Trigger disabled by config, skipping` log emitted at every disabled
 * lookup; webhook-log decisionReasons just shift from a per-handler
 * structured message to the registry-level `No trigger matched` (which
 * accurately describes the dispatch outcome when no handler claimed).
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
			skipResult: null,
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

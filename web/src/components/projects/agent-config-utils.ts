/**
 * Pure utility functions for agent configuration components.
 * These functions are free of React and UI dependencies — easy to unit-test.
 */

import type { ResolvedTrigger } from '../shared/definition-trigger-toggles.js';
import { engineCredentialKeys } from './engine-secrets.js';

/**
 * Returns true when the given engine has at least one credential key configured.
 * Derived from ENGINE_SECRETS in engine-secrets.ts — no separate mapping to maintain.
 * If the engine is not in the map, we conservatively assume credentials are present.
 */
export function engineHasCredentials(
	engineId: string,
	configuredCredentialKeys: Set<string>,
): boolean {
	const requiredKeys = engineCredentialKeys[engineId];
	if (!requiredKeys) return true; // Unknown engine — assume ok
	return requiredKeys.some((key) => configuredCredentialKeys.has(key));
}

/**
 * Counts the number of active triggers for an agent, filtering by provider
 * when the trigger has provider restrictions.
 */
export function countActiveTriggers(
	triggers: ResolvedTrigger[],
	integrations: { pm: string | null; scm: string | null },
): number {
	return triggers.filter((t) => {
		if (!t.enabled) return false;
		const [category] = t.event.split(':');
		if (t.providers && t.providers.length > 0) {
			const activeProvider = integrations[category as keyof typeof integrations];
			return t.providers.some((p) => p === activeProvider);
		}
		return true;
	}).length;
}

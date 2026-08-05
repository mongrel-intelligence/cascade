/**
 * Pure utility functions for agent configuration components.
 * These functions are free of React and UI dependencies — easy to unit-test.
 */

import type { ResolvedTrigger } from '../shared/definition-trigger-toggles.js';
import type { Engine } from './agent-config-types.js';
import { engineCredentialKeys } from './engine-secrets.js';

/**
 * Returns true when `model` is compatible with a `select`-type engine — i.e. it
 * is one of the engine's catalog options OR matches one of the engine's accepted
 * model prefixes (`acceptedModelPrefixes`). Mirrors the runtime acceptance rules
 * enforced by `resolveClaudeModel` / `resolveCodexModel` so the dashboard can
 * warn at configuration time instead of crashing the run mid-flight (MNG-1772).
 *
 * `free-text` engines (and engines whose selection shape is unknown) accept any
 * model string, so this always returns true for them — avoids false positives.
 */
export function isModelCompatibleWithEngine(model: string, engine: Engine): boolean {
	const selection = engine.modelSelection;
	// Only select-type engines constrain the model set.
	if (!selection || selection.type !== 'select') return true;
	// An empty model means "inherit"; compatibility is judged on the resolved
	// value by the caller — treat empty as compatible here.
	if (!model) return true;
	if (selection.options.some((option) => option.value === model)) return true;
	const prefixes = selection.acceptedModelPrefixes ?? [];
	return prefixes.some((prefix) => model.startsWith(prefix));
}

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

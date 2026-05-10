/**
 * Frontend provider-wizard registry — mirrors `src/integrations/pm/registry.ts`.
 *
 * Providers register their wizard definition at module-load time by
 * calling `registerProviderWizard(def)` from the provider's frontend
 * `index.ts`. The generic wizard renderer (`pm-wizard.tsx`) lists provider
 * definitions from this registry for the picker and looks up the active
 * provider here before rendering manifest-driven steps.
 */

import type { ProviderWizardDefinition } from './types.js';

const registry: ProviderWizardDefinition[] = [];
const byId = new Map<string, ProviderWizardDefinition>();

export function registerProviderWizard(def: ProviderWizardDefinition): void {
	if (byId.has(def.id)) {
		throw new Error(
			`Provider wizard '${def.id}' already registered — duplicate ids are not allowed`,
		);
	}
	registry.push(def);
	byId.set(def.id, def);
}

export function getProviderWizard(id: string): ProviderWizardDefinition | null {
	return byId.get(id) ?? null;
}

export function listProviderWizards(): readonly ProviderWizardDefinition[] {
	return registry.slice();
}

/** Test-only — clears between tests. Not used in production. */
export function _resetProviderWizardRegistryForTesting(): void {
	registry.length = 0;
	byId.clear();
}

/**
 * Regression: built-in trigger handler name uniqueness with real implementations.
 *
 * Unlike builtins.test.ts — which mocks every trigger module and
 * listPMProviders() so it can assert on ordering/counts — this file uses the
 * real production PM manifests (Trello, JIRA, Linear) and real GitHub/Sentry
 * trigger classes.  That means a duplicate name introduced anywhere in
 * src/triggers/ or in a PM manifest's triggerHandlers array will fail this
 * test at CI time, not just when the mock is also updated.
 */

import { describe, expect, it } from 'vitest';

// Side-effect imports: register the real production PM providers so
// listPMProviders() (called inside registerBuiltInTriggers) returns the
// actual Trello, JIRA, and Linear manifests with their real handler names.
import '../../../src/integrations/pm/trello/index.js';
import '../../../src/integrations/pm/jira/index.js';
import '../../../src/integrations/pm/linear/index.js';

import { registerBuiltInTriggers } from '../../../src/triggers/builtins.js';
import type { TriggerRegistry } from '../../../src/triggers/registry.js';

function createCollectingRegistry(): {
	register: (handler: unknown) => void;
	handlers: unknown[];
} {
	const handlers: unknown[] = [];
	return {
		register: (handler: unknown) => handlers.push(handler),
		handlers,
	};
}

describe('registerBuiltInTriggers — real handler name uniqueness', () => {
	it('registers each built-in trigger handler name exactly once across PM, SCM, and alerting', () => {
		const registry = createCollectingRegistry();

		registerBuiltInTriggers(registry as unknown as TriggerRegistry);

		const registeredNames = registry.handlers.map((h) => (h as { name: string }).name);
		const countsByName = new Map<string, number>();
		for (const name of registeredNames) {
			countsByName.set(name, (countsByName.get(name) ?? 0) + 1);
		}

		const duplicates = [...countsByName.entries()]
			.filter(([, count]) => count > 1)
			.map(([name, count]) => `${name} (${count} registrations)`);

		expect(
			duplicates,
			`Built-in trigger handler names must be globally unique across PM, SCM, alerting, and internal registrations.\n` +
				`Duplicate names:\n${duplicates.map((d) => `  - ${d}`).join('\n')}`,
		).toEqual([]);
	});
});

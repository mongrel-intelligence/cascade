/**
 * Verifies the CLI bootstrap module triggers PM/SCM/alerting provider
 * registration. The CLI runs commands lazily under oclif, so the side-effect
 * imports must fire before any command instantiates a PM provider — otherwise
 * `cascade-tools pm <cmd>` throws `Unknown PM integration type` from an empty
 * registry. (Reproduced live: see backlog-manager run for MNG-94 on llmist.)
 *
 * Mirrors the bootstrap pattern used by the router (src/router/index.ts) and
 * the worker (src/worker-entry.ts).
 */

import { describe, expect, it } from 'vitest';

// Side-effect import under test — must register PM manifests.
import '../../../src/cli/bootstrap.js';

import { listPMProviders } from '../../../src/integrations/pm/registry.js';

describe('cli/bootstrap', () => {
	it('registers all PM providers (linear, jira, trello)', () => {
		const ids = listPMProviders().map((p) => p.id);
		expect(ids).toEqual(expect.arrayContaining(['linear', 'jira', 'trello']));
	});
});

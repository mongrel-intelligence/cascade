/**
 * Static guard: every PM router adapter must establish PM-provider AsyncLocalStorage
 * scope around `triggerRegistry.dispatch(ctx)`. Without this, the pipeline-capacity
 * gate at `src/triggers/shared/pipeline-capacity-gate.ts` cannot resolve the
 * project's PM provider, fails closed (post-spec 017 plan 2), and Sentry captures
 * under tag `pipeline_capacity_gate_no_pm_provider`. Live incident verified
 * 2026-04-29: 32 occurrences/day on prod cascade-router.
 *
 * Compares each PM router adapter source file against the GitHub adapter's
 * correct shape (which wraps in `withPMProvider` at
 * `src/router/adapters/github.ts:dispatchWithCredentials`). A future PM router
 * adapter that omits the wrapping fails this guard with a precise file path.
 *
 * Modeled on `tests/unit/triggers/trigger-event-consistency.test.ts` —
 * static-grep style regression net.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTER_ADAPTERS_DIR = join(__dirname, '..', '..', '..', 'src', 'router', 'adapters');

// PM router adapters that drive PM `status-changed` triggers. Each must
// establish PM-provider scope before invoking `triggerRegistry.dispatch(ctx)`.
// Adding a new PM router adapter file here is part of the contract: the
// guard fails fast on unregistered adapters too if they end up dispatching
// without scope.
const PM_ROUTER_ADAPTER_FILES = ['linear.ts', 'trello.ts', 'jira.ts', 'github-projects.ts'];

const ACCEPTABLE_WRAPPERS = ['withPMScopeForDispatch', 'withPMProvider'];

describe('PM router adapter PM-provider scope (static guard)', () => {
	for (const filename of PM_ROUTER_ADAPTER_FILES) {
		it(`${filename} establishes PM-provider scope around trigger dispatch`, () => {
			const path = join(ROUTER_ADAPTERS_DIR, filename);
			const src = readFileSync(path, 'utf-8');

			// Strip line comments and block comments to avoid false positives
			// from doc references that mention the wrapper names.
			const codeOnly = src
				.split('\n')
				.filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
				.join('\n');

			const found = ACCEPTABLE_WRAPPERS.find((wrapper) => codeOnly.includes(wrapper));

			expect(
				found,
				`src/router/adapters/${filename} must wrap trigger dispatch in PM-provider AsyncLocalStorage scope. ` +
					`Expected one of: ${ACCEPTABLE_WRAPPERS.join(', ')}. ` +
					`Without this wrapping, the pipeline-capacity gate (` +
					`src/triggers/shared/pipeline-capacity-gate.ts) cannot resolve the project's PM ` +
					`provider, fails closed under the spec-017 fail-closed policy, and Sentry captures ` +
					`under tag pipeline_capacity_gate_no_pm_provider.`,
			).toBeTruthy();
		});
	}
});

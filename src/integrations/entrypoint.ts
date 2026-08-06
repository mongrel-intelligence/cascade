/**
 * Single canonical registration entrypoint for every CASCADE integration.
 *
 * Every runtime surface (router, worker, CLI, dashboard, test setup) imports
 * this file as a side-effect module. The imports below trigger each
 * integration's module-load registration: PM providers register into
 * `pmProviderRegistry` (and mirror into `integrationRegistry`), GitHub
 * registers into `integrationRegistry`, Sentry registers into
 * `integrationRegistry`.
 *
 * Why one file: prior to plan 009/1, each runtime surface hand-maintained
 * its own list of barrel imports. Forgetting to add a new provider to one
 * of them was the root cause of bugs #1118 (Linear worker without
 * credentials), #1131 (CLI didn't load Linear providers), #1134 (CLI PM
 * scope synth), and #1097 (Linear registration path gap). Collapsing the
 * list to one file is a one-time fix — the test
 * `tests/unit/integrations/entrypoint-usage.test.ts` guards the invariant.
 *
 * Plan 5 of spec 009 deletes any legacy direct barrel imports from runtime
 * code paths, making this the *only* registration entry.
 */

// PM providers (Trello, JIRA, Linear) — registers via the barrel's side
// effects, then mirrors into the cross-category integrationRegistry.
import './pm/index.js';

// SCM — GitHub. Registers integrationModule + trigger handlers.
import '../github/register.js';

// SCM — GitLab. Registers integrationModule + trigger handlers.
import '../gitlab/register.js';

// Alerting — Sentry. Registers integrationModule + trigger handlers.
import '../sentry/register.js';

/**
 * Explicit no-op invocation for test setups that want to make registration
 * visible at call sites (rather than relying on the import side effect
 * implicitly). In production, the mere import of this module is enough.
 */
export function registerAllIntegrations(): void {
	// Intentionally empty. The `import` statements above have already done
	// the work by the time this function is callable.
}

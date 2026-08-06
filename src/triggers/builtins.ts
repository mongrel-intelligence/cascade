/**
 * Trigger handler registration — safe to import from the router.
 *
 * This module only imports the trigger handler classes (pure logic, no API
 * clients). It does NOT import webhook handlers, which transitively pull in
 * the full agent execution pipeline (including .eta template files that
 * aren't present in the router Docker image).
 *
 * The barrel `./index.ts` re-exports both trigger handlers AND webhook
 * handlers, so importing from it at module scope in the router would cause
 * the router to crash with ENOENT on template files.
 *
 * Each platform owns its trigger registration via a `registerXxxTriggers`
 * function in its `<platform>/register.ts` module. Adding a new platform
 * requires:
 *   1. Creating `triggers/<platform>/register.ts` with a `registerXxxTriggers`
 *      function that registers the platform's triggers.
 *   2. Importing and calling it here.
 */

import { listPMProviders } from '../integrations/pm/registry.js';
import { registerGitHubTriggers } from './github/register.js';
import { registerGitLabTriggers } from './gitlab/register.js';
import type { TriggerRegistry } from './registry.js';
import { registerSentryTriggers } from './sentry/register.js';

export function registerBuiltInTriggers(registry: TriggerRegistry): void {
	// Every PM provider (Trello, JIRA, Linear) contributes triggers via the
	// manifest registry. SCM (GitHub) and alerting (Sentry) still use legacy
	// registration — spec 006 scoped to PM only.
	for (const manifest of listPMProviders()) {
		for (const handler of manifest.triggerHandlers) {
			registry.register(handler);
		}
	}
	registerGitHubTriggers(registry);
	registerGitLabTriggers(registry);
	registerSentryTriggers(registry);
}

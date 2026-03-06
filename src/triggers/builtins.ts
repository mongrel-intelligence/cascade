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

import { registerGitHubTriggers } from './github/register.js';
import { registerJiraTriggers } from './jira/register.js';
import type { TriggerRegistry } from './registry.js';
import { registerTrelloTriggers } from './trello/register.js';

export function registerBuiltInTriggers(registry: TriggerRegistry): void {
	registerTrelloTriggers(registry);
	registerJiraTriggers(registry);
	registerGitHubTriggers(registry);
}

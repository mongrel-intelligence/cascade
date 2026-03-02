/**
 * JIRA trigger registration.
 *
 * This module only imports trigger handler classes (no webhook handlers,
 * no agent execution pipeline) so it is safe to import from the router.
 *
 * `registerJiraTriggers` is the single call-site for wiring all built-in
 * JIRA triggers into a registry. Adding a new JIRA trigger only
 * requires updating this file, not `builtins.ts`.
 */

import type { TriggerRegistry } from '../registry.js';
import { JiraCommentMentionTrigger } from './comment-mention.js';
import { JiraReadyToProcessLabelTrigger } from './label-added.js';
import { JiraStatusChangedTrigger } from './status-changed.js';

/**
 * Register all built-in JIRA triggers into the given registry.
 *
 * Order matters: JiraCommentMentionTrigger must be registered before
 * the status-changed trigger so it gets first crack at comment events.
 */
export function registerJiraTriggers(registry: TriggerRegistry): void {
	// Must be registered before status-changed trigger
	registry.register(new JiraCommentMentionTrigger());

	registry.register(new JiraStatusChangedTrigger());
	registry.register(new JiraReadyToProcessLabelTrigger());
}

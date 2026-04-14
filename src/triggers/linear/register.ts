/**
 * Linear trigger registration.
 *
 * This module only imports trigger handler classes (no webhook handlers,
 * no agent execution pipeline) so it is safe to import from the router.
 *
 * `registerLinearTriggers` is the single call-site for wiring all built-in
 * Linear triggers into a registry. Adding a new Linear trigger only
 * requires updating this file, not `builtins.ts`.
 */

import type { TriggerRegistry } from '../registry.js';
import { LinearCommentMentionTrigger } from './comment-mention.js';
import { LinearReadyToProcessLabelTrigger } from './label-added.js';
import { LinearStatusChangedTrigger } from './status-changed.js';

/**
 * Register all built-in Linear triggers into the given registry.
 *
 * Order matters: LinearCommentMentionTrigger must be registered before
 * the status-changed trigger so it gets first crack at comment events.
 */
export function registerLinearTriggers(registry: TriggerRegistry): void {
	// Must be registered before status-changed trigger
	registry.register(new LinearCommentMentionTrigger());

	registry.register(new LinearStatusChangedTrigger());
	registry.register(new LinearReadyToProcessLabelTrigger());
}

/**
 * Trello trigger registration.
 *
 * This module only imports trigger handler classes (no webhook handlers,
 * no agent execution pipeline) so it is safe to import from the router.
 *
 * `registerTrelloTriggers` is the single call-site for wiring all built-in
 * Trello triggers into a registry. Adding a new Trello trigger only
 * requires updating this file, not `builtins.ts`.
 */

import type { TriggerRegistry } from '../registry.js';
import { TrelloCommentMentionTrigger } from './comment-mention.js';
import { ReadyToProcessLabelTrigger } from './label-added.js';
import {
	TrelloStatusChangedPlanningTrigger,
	TrelloStatusChangedSplittingTrigger,
	TrelloStatusChangedTodoTrigger,
} from './status-changed.js';

/**
 * Register all built-in Trello triggers into the given registry.
 *
 * Order matters: TrelloCommentMentionTrigger must be registered before
 * status-changed triggers so it gets first crack at comment events.
 */
export function registerTrelloTriggers(registry: TriggerRegistry): void {
	// Must be registered before status-changed triggers
	registry.register(new TrelloCommentMentionTrigger());

	registry.register(TrelloStatusChangedSplittingTrigger);
	registry.register(TrelloStatusChangedPlanningTrigger);
	registry.register(TrelloStatusChangedTodoTrigger);

	registry.register(new ReadyToProcessLabelTrigger());
}

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
import {
	CardMovedToPlanningTrigger,
	CardMovedToSplittingTrigger,
	CardMovedToTodoTrigger,
} from './card-moved.js';
import { TrelloCommentMentionTrigger } from './comment-mention.js';
import { ReadyToProcessLabelTrigger } from './label-added.js';

/**
 * Register all built-in Trello triggers into the given registry.
 *
 * Order matters: TrelloCommentMentionTrigger must be registered before
 * card-moved triggers so it gets first crack at comment events.
 */
export function registerTrelloTriggers(registry: TriggerRegistry): void {
	// Must be registered before card-moved triggers
	registry.register(new TrelloCommentMentionTrigger());

	registry.register(CardMovedToSplittingTrigger);
	registry.register(CardMovedToPlanningTrigger);
	registry.register(CardMovedToTodoTrigger);

	registry.register(new ReadyToProcessLabelTrigger());
}

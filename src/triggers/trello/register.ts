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
	TrelloCustomStatusChangedTrigger,
	TrelloStatusChangedBacklogTrigger,
	TrelloStatusChangedMergedTrigger,
	TrelloStatusChangedPlanningTrigger,
	TrelloStatusChangedSplittingTrigger,
	TrelloStatusChangedTodoTrigger,
} from './status-changed.js';

/**
 * Register all built-in Trello triggers into the given registry.
 *
 * Order matters: TrelloCommentMentionTrigger must be registered before
 * status-changed triggers so it gets first crack at comment events.
 * TrelloCustomStatusChangedTrigger is registered after the built-in
 * per-list triggers (so they get first crack at their hardcoded lists)
 * and before the ready-label trigger (so status changes are handled
 * before label-driven dispatch).
 */
export function registerTrelloTriggers(registry: TriggerRegistry): void {
	// Must be registered before status-changed triggers
	registry.register(new TrelloCommentMentionTrigger());

	registry.register(TrelloStatusChangedSplittingTrigger);
	registry.register(TrelloStatusChangedPlanningTrigger);
	registry.register(TrelloStatusChangedTodoTrigger);
	registry.register(TrelloStatusChangedBacklogTrigger);
	registry.register(TrelloStatusChangedMergedTrigger);
	registry.register(new TrelloCustomStatusChangedTrigger());

	registry.register(new ReadyToProcessLabelTrigger());
}

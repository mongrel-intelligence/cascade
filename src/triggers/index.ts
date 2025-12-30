import type { TriggerRegistry } from './registry.js';
import {
	CardMovedToBriefingTrigger,
	CardMovedToPlanningTrigger,
	CardMovedToTodoTrigger,
} from './trello/card-moved.js';
import { ReadyToProcessLabelTrigger } from './trello/label-added.js';

export { type TriggerRegistry, createTriggerRegistry } from './registry.js';
export type {
	TriggerContext,
	TriggerHandler,
	TriggerResult,
	TrelloWebhookPayload,
} from './types.js';
export { isTrelloWebhookPayload } from './types.js';
export { processTrelloWebhook } from './trello/webhook-handler.js';

export function registerBuiltInTriggers(registry: TriggerRegistry): void {
	// Card moved triggers
	registry.register(new CardMovedToBriefingTrigger());
	registry.register(new CardMovedToPlanningTrigger());
	registry.register(new CardMovedToTodoTrigger());

	// Label triggers
	registry.register(new ReadyToProcessLabelTrigger());
}

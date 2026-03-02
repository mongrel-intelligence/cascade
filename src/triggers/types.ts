import type { TriggerContext, TriggerHandler, TriggerResult } from '../types/index.js';

export type { TriggerContext, TriggerHandler, TriggerResult };

// Re-export Trello types from their canonical location
export type { TrelloWebhookPayload } from './trello/types.js';
export { isTrelloWebhookPayload } from './trello/types.js';

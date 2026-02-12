import type {
	TrelloWebhookPayload,
	TriggerContext,
	TriggerHandler,
	TriggerResult,
} from '../types.js';
import { isTrelloWebhookPayload } from '../types.js';

// ============================================================================
// Card Moved/Created Trigger Factory
// ============================================================================

interface CardMovedConfig {
	name: string;
	description: string;
	listKey: 'briefing' | 'planning' | 'todo';
	agentType: string;
}

function createCardMovedTrigger(config: CardMovedConfig): TriggerHandler {
	return {
		name: config.name,
		description: config.description,

		matches(ctx: TriggerContext): boolean {
			if (ctx.source !== 'trello') return false;
			if (!isTrelloWebhookPayload(ctx.payload)) return false;

			const payload = ctx.payload;
			const targetListId = ctx.project.trello.lists[config.listKey];

			// Card moved into the target list
			const isMove =
				payload.action.type === 'updateCard' &&
				payload.action.data.listAfter?.id === targetListId &&
				payload.action.data.listBefore?.id !== targetListId;

			// Card created directly in the target list
			const isCreate =
				payload.action.type === 'createCard' && payload.action.data.list?.id === targetListId;

			return isMove || isCreate;
		},

		async handle(ctx: TriggerContext): Promise<TriggerResult> {
			const payload = ctx.payload as TrelloWebhookPayload;
			const cardId = payload.action.data.card?.id;

			if (!cardId) {
				throw new Error('No card ID in payload');
			}

			return {
				agentType: config.agentType,
				agentInput: { cardId },
				cardId,
			};
		},
	};
}

// ============================================================================
// Trigger Instances
// ============================================================================

export const CardMovedToBriefingTrigger = createCardMovedTrigger({
	name: 'card-moved-to-briefing',
	description: 'Triggers briefing agent when card moved to briefing list',
	listKey: 'briefing',
	agentType: 'briefing',
});

export const CardMovedToPlanningTrigger = createCardMovedTrigger({
	name: 'card-moved-to-planning',
	description: 'Triggers planning agent when card moved to planning list',
	listKey: 'planning',
	agentType: 'planning',
});

export const CardMovedToTodoTrigger = createCardMovedTrigger({
	name: 'card-moved-to-todo',
	description: 'Triggers implementation agent when card moved to TODO list',
	listKey: 'todo',
	agentType: 'implementation',
});

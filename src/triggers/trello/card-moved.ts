import type {
	TrelloWebhookPayload,
	TriggerContext,
	TriggerHandler,
	TriggerResult,
} from '../types.js';
import { isTrelloWebhookPayload } from '../types.js';

export class CardMovedToBriefingTrigger implements TriggerHandler {
	name = 'card-moved-to-briefing';
	description = 'Triggers briefing agent when card moved to briefing list';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'trello') return false;
		if (!isTrelloWebhookPayload(ctx.payload)) return false;

		const payload = ctx.payload;
		const briefingListId = ctx.project.trello.lists.briefing;

		return (
			payload.action.type === 'updateCard' &&
			payload.action.data.listAfter?.id === briefingListId &&
			payload.action.data.listBefore?.id !== briefingListId
		);
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult> {
		const payload = ctx.payload as TrelloWebhookPayload;
		const cardId = payload.action.data.card?.id;

		if (!cardId) {
			throw new Error('No card ID in payload');
		}

		return {
			agentType: 'briefing',
			agentInput: { cardId },
			cardId,
		};
	}
}

export class CardMovedToPlanningTrigger implements TriggerHandler {
	name = 'card-moved-to-planning';
	description = 'Triggers planning agent when card moved to planning list';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'trello') return false;
		if (!isTrelloWebhookPayload(ctx.payload)) return false;

		const payload = ctx.payload;
		const planningListId = ctx.project.trello.lists.planning;

		return (
			payload.action.type === 'updateCard' &&
			payload.action.data.listAfter?.id === planningListId &&
			payload.action.data.listBefore?.id !== planningListId
		);
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult> {
		const payload = ctx.payload as TrelloWebhookPayload;
		const cardId = payload.action.data.card?.id;

		if (!cardId) {
			throw new Error('No card ID in payload');
		}

		return {
			agentType: 'planning',
			agentInput: { cardId },
			cardId,
		};
	}
}

export class CardMovedToTodoTrigger implements TriggerHandler {
	name = 'card-moved-to-todo';
	description = 'Triggers implementation agent when card moved to TODO list';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'trello') return false;
		if (!isTrelloWebhookPayload(ctx.payload)) return false;

		const payload = ctx.payload;
		const todoListId = ctx.project.trello.lists.todo;

		return (
			payload.action.type === 'updateCard' &&
			payload.action.data.listAfter?.id === todoListId &&
			payload.action.data.listBefore?.id !== todoListId
		);
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult> {
		const payload = ctx.payload as TrelloWebhookPayload;
		const cardId = payload.action.data.card?.id;

		if (!cardId) {
			throw new Error('No card ID in payload');
		}

		return {
			agentType: 'implementation',
			agentInput: { cardId },
			cardId,
		};
	}
}

import { trelloClient } from '../../trello/client.js';
import { logger } from '../../utils/logging.js';
import type {
	TrelloWebhookPayload,
	TriggerContext,
	TriggerHandler,
	TriggerResult,
} from '../types.js';
import { isTrelloWebhookPayload } from '../types.js';

export class ReadyToProcessLabelTrigger implements TriggerHandler {
	name = 'ready-to-process-label-added';
	description = 'Triggers agent based on current list when "Ready to Process" label is added';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'trello') return false;
		if (!isTrelloWebhookPayload(ctx.payload)) return false;

		const payload = ctx.payload;
		const readyLabelId = ctx.project.trello.labels.readyToProcess;

		return (
			payload.action.type === 'addLabelToCard' && payload.action.data.label?.id === readyLabelId
		);
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult> {
		const payload = ctx.payload as TrelloWebhookPayload;
		const cardId = payload.action.data.card?.id;

		if (!cardId) {
			throw new Error('No card ID in payload');
		}

		// Fetch card to get current list ID (webhook payload doesn't include it for addLabelToCard)
		const card = await trelloClient.getCard(cardId);
		const currentListId = card.idList;

		logger.info('Determining agent type from list', { cardId, currentListId });

		// Determine agent type based on current list
		const lists = ctx.project.trello.lists;
		let agentType: string;

		if (currentListId === lists.briefing) {
			agentType = 'briefing';
		} else if (currentListId === lists.planning) {
			agentType = 'planning';
		} else if (currentListId === lists.todo) {
			agentType = 'implementation';
		} else {
			// Default to briefing if list not recognized
			logger.warn('Card in unrecognized list, defaulting to briefing', { currentListId, lists });
			agentType = 'briefing';
		}

		logger.info('Agent type determined', { agentType, cardId, listId: currentListId });

		return {
			agentType,
			agentInput: { cardId },
			cardId,
		};
	}
}

import { getTrelloConfig } from '../../pm/config.js';
import { trelloClient } from '../../trello/client.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
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

		const trelloConfig = getTrelloConfig(ctx.project);
		const payload = ctx.payload;
		const readyLabelId = trelloConfig?.labels.readyToProcess;

		return (
			payload.action.type === 'addLabelToCard' && payload.action.data.label?.id === readyLabelId
		);
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as TrelloWebhookPayload;
		const cardId = payload.action.data.card?.id;

		if (!cardId) {
			logger.warn('No card ID in Trello label-added payload');
			return null;
		}

		// Fetch card to get current list ID (webhook payload doesn't include it for addLabelToCard)
		const card = await trelloClient.getCard(cardId);
		const currentListId = card.idList;

		logger.info('Determining agent type from list', { cardId, currentListId });

		// Determine agent type based on current list
		const lists = getTrelloConfig(ctx.project)?.lists ?? {};
		let agentType: string;

		if (currentListId === lists.splitting) {
			agentType = 'splitting';
		} else if (currentListId === lists.planning) {
			agentType = 'planning';
		} else if (currentListId === lists.todo) {
			agentType = 'implementation';
		} else {
			logger.info('Card not in a trigger-eligible list, skipping ready-to-process label', {
				currentListId,
				lists,
			});
			return null;
		}

		logger.info('Agent type determined', { agentType, cardId, listId: currentListId });

		// Check per-agent ready-to-process toggle via new DB-driven system
		if (!(await checkTriggerEnabled(ctx.project.id, agentType, 'pm:label-added', this.name))) {
			return null;
		}

		// Capture work item display data from the fetched card
		// card.shortUrl is the canonical short URL (e.g. https://trello.com/c/abc123)
		const workItemUrl = card.shortUrl || undefined;
		const workItemTitle = card.name || undefined;

		return {
			agentType,
			agentInput: { cardId, workItemUrl, workItemTitle },
			workItemId: cardId,
			workItemUrl,
			workItemTitle,
		};
	}
}

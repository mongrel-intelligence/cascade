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
		const currentListId = payload.action.data.list?.id;

		if (!cardId) {
			throw new Error('No card ID in payload');
		}

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
			agentType = 'briefing';
		}

		return {
			agentType,
			agentInput: { cardId },
			cardId,
		};
	}
}

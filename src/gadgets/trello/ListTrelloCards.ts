import { Gadget, z } from 'llmist';
import { listCards } from './core/listCards.js';

export class ListTrelloCards extends Gadget({
	name: 'ListTrelloCards',
	description:
		'List all cards on a Trello list. Use this to see cards you created or to find cards to update.',
	timeoutMs: 30000,
	schema: z.object({
		listId: z.string().describe('The Trello list ID'),
	}),
	examples: [
		{
			params: { listId: 'abc123' },
			comment: 'List all cards in the STORIES list to find ones to update',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return listCards(params.listId);
	}
}

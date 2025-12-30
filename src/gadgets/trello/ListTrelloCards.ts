import { Gadget, z } from 'llmist';
import { trelloClient } from '../../trello/client.js';

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
		try {
			const cards = await trelloClient.getListCards(params.listId);

			if (cards.length === 0) {
				return 'No cards found in this list.';
			}

			let result = `# Cards (${cards.length})\n\n`;
			for (const card of cards) {
				result += `## ${card.name}\n`;
				result += `- **ID:** ${card.id}\n`;
				result += `- **URL:** ${card.shortUrl}\n`;
				if (card.desc) {
					result += `- **Description:** ${card.desc.slice(0, 100)}${card.desc.length > 100 ? '...' : ''}\n`;
				}
				result += '\n';
			}

			return result;
		} catch (error) {
			return `Error listing cards: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}

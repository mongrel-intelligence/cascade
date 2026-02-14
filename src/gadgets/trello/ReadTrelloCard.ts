import { Gadget, z } from 'llmist';
import { readCard } from './core/readCard.js';

export class ReadTrelloCard extends Gadget({
	name: 'ReadTrelloCard',
	description:
		'Read a Trello card to retrieve its title, description, comments, checklists, and attachments. Use this to understand the current state of the card before making changes.',
	timeoutMs: 30000,
	schema: z.object({
		cardId: z.string().describe('The Trello card ID'),
		includeComments: z
			.boolean()
			.optional()
			.default(true)
			.describe('Whether to include comments in the response'),
	}),
	examples: [
		{
			params: { cardId: 'abc123', includeComments: true },
			comment: 'Read the card with its comments to understand context',
		},
		{
			params: { cardId: 'abc123', includeComments: false },
			comment: 'Read just the card title and description',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return readCard(params.cardId, params.includeComments);
	}
}

/** @deprecated Use readCard from './core/readCard.js' instead */
export { readCard as formatCardData } from './core/readCard.js';

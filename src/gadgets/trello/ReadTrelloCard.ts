import { Gadget, z } from 'llmist';
import { trelloClient } from '../../trello/client.js';

export class ReadTrelloCard extends Gadget({
	name: 'ReadTrelloCard',
	description:
		'Read a Trello card to retrieve its title, description, and comments. Use this to understand the current state of the card before making changes.',
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
		try {
			const card = await trelloClient.getCard(params.cardId);

			let result = `# ${card.name}\n\n`;
			result += `**URL:** ${card.url}\n\n`;
			result += `## Description\n\n${card.desc || '(No description)'}\n\n`;

			if (card.labels.length > 0) {
				result += '## Labels\n\n';
				result += card.labels.map((l) => `- ${l.name} (${l.color})`).join('\n');
				result += '\n\n';
			}

			if (params.includeComments) {
				const comments = await trelloClient.getCardComments(params.cardId);
				if (comments.length > 0) {
					result += `## Comments (${comments.length})\n\n`;
					for (const comment of comments.slice().reverse()) {
						const date = new Date(comment.date).toISOString();
						result += `### ${comment.memberCreator.fullName} (${date})\n\n`;
						result += `${comment.data.text}\n\n`;
					}
				} else {
					result += '## Comments\n\n(No comments)\n\n';
				}
			}

			return result;
		} catch (error) {
			return `Error reading card: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}

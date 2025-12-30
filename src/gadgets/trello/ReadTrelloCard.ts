import { z } from 'zod';
import { trelloClient } from '../../trello/client.js';

export const ReadTrelloCardSchema = z.object({
	cardId: z.string().describe('The Trello card ID'),
	includeComments: z.boolean().default(true).describe('Whether to include card comments'),
});

export type ReadTrelloCardParams = z.infer<typeof ReadTrelloCardSchema>;

export const ReadTrelloCardGadget = {
	name: 'ReadTrelloCard',
	description: 'Read a Trello card including its title, description, URL, and optionally comments',
	schema: ReadTrelloCardSchema,

	async execute(params: ReadTrelloCardParams): Promise<string> {
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
				result += '## Comments\n\n';
				for (const comment of comments.slice().reverse()) {
					result += `### ${comment.memberCreator.fullName} (${comment.date})\n\n`;
					result += `${comment.data.text}\n\n`;
				}
			}
		}

		return result;
	},
};

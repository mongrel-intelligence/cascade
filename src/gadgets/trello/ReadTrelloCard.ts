import { Gadget, z } from 'llmist';
import { trelloClient } from '../../trello/client.js';

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
		return formatCardData(params.cardId, params.includeComments);
	}
}

export async function formatCardData(cardId: string, includeComments = true): Promise<string> {
	try {
		const [card, checklists, attachments] = await Promise.all([
			trelloClient.getCard(cardId),
			trelloClient.getCardChecklists(cardId),
			trelloClient.getCardAttachments(cardId),
		]);

		let result = `# ${card.name}\n\n`;
		result += `**URL:** ${card.url}\n\n`;
		result += `## Description\n\n${card.desc || '(No description)'}\n\n`;

		if (card.labels.length > 0) {
			result += '## Labels\n\n';
			result += card.labels.map((l) => `- ${l.name} (${l.color})`).join('\n');
			result += '\n\n';
		}

		if (checklists.length > 0) {
			result += '## Checklists\n\n';
			for (const checklist of checklists) {
				result += `### ${checklist.name}\n\n`;
				for (const item of checklist.checkItems) {
					const checkbox = item.state === 'complete' ? '[x]' : '[ ]';
					result += `- ${checkbox} ${item.name}\n`;
				}
				result += '\n';
			}
		}

		if (attachments.length > 0) {
			result += '## Attachments\n\n';
			for (const att of attachments) {
				result += `- [${att.name}](${att.url})`;
				if (att.date) {
					result += ` (${new Date(att.date).toISOString()})`;
				}
				result += '\n';
			}
			result += '\n';
		}

		if (includeComments) {
			const comments = await trelloClient.getCardComments(cardId);
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

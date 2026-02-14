import { trelloClient } from '../../../trello/client.js';

export async function listCards(listId: string): Promise<string> {
	try {
		const cards = await trelloClient.getListCards(listId);

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
		const message = error instanceof Error ? error.message : String(error);
		return `Error listing cards: ${message}`;
	}
}

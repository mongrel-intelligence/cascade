import { trelloClient } from '../../../trello/client.js';

export async function postComment(cardId: string, text: string): Promise<string> {
	try {
		await trelloClient.addComment(cardId, text);
		return 'Comment posted successfully';
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error posting comment: ${message}`;
	}
}

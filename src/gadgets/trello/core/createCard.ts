import { trelloClient } from '../../../trello/client.js';

export interface CreateCardParams {
	listId: string;
	title: string;
	description?: string;
}

export async function createCard(params: CreateCardParams): Promise<string> {
	try {
		const card = await trelloClient.createCard(params.listId, {
			name: params.title,
			desc: params.description,
		});

		return `Card created successfully: "${card.name}" - ${card.shortUrl}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error creating card: ${message}`;
	}
}

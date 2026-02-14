import { trelloClient } from '../../../trello/client.js';

export interface UpdateCardParams {
	cardId: string;
	title?: string;
	description?: string;
	addLabelIds?: string[];
}

export async function updateCard(params: UpdateCardParams): Promise<string> {
	if (!params.title && !params.description && !params.addLabelIds?.length) {
		return 'Nothing to update - provide title, description, or labels';
	}

	try {
		if (params.title || params.description) {
			await trelloClient.updateCard(params.cardId, {
				name: params.title,
				desc: params.description,
			});
		}

		if (params.addLabelIds?.length) {
			for (const labelId of params.addLabelIds) {
				await trelloClient.addLabelToCard(params.cardId, labelId);
			}
		}

		const updated: string[] = [];
		if (params.title) updated.push('title');
		if (params.description) updated.push('description');
		if (params.addLabelIds?.length) updated.push(`${params.addLabelIds.length} label(s)`);

		return `Card updated: ${updated.join(', ')}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error updating card: ${message}`;
	}
}

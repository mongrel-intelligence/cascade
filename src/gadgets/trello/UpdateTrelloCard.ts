import { z } from 'zod';
import { trelloClient } from '../../trello/client.js';

export const UpdateTrelloCardSchema = z.object({
	cardId: z.string().describe('The Trello card ID'),
	title: z
		.string()
		.max(80)
		.optional()
		.describe('New card title (max 80 chars). Should be action-oriented.'),
	description: z.string().optional().describe('New card description (markdown supported)'),
});

export type UpdateTrelloCardParams = z.infer<typeof UpdateTrelloCardSchema>;

export const UpdateTrelloCardGadget = {
	name: 'UpdateTrelloCard',
	description: 'Update a Trello card title and/or description. Use this to save your analysis.',
	schema: UpdateTrelloCardSchema,

	async execute(params: UpdateTrelloCardParams): Promise<string> {
		if (!params.title && !params.description) {
			return 'Nothing to update - provide title or description';
		}

		await trelloClient.updateCard(params.cardId, {
			name: params.title,
			desc: params.description,
		});

		const updated: string[] = [];
		if (params.title) updated.push('title');
		if (params.description) updated.push('description');

		return `Card updated: ${updated.join(', ')}`;
	},
};

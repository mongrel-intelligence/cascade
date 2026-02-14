import { Gadget, z } from 'llmist';
import { updateCard } from './core/updateCard.js';

export class UpdateTrelloCard extends Gadget({
	name: 'UpdateTrelloCard',
	description:
		'Update a Trello card title and/or description. Use this to save your analysis, brief, or plan to the card.',
	timeoutMs: 30000,
	schema: z.object({
		cardId: z.string().describe('The Trello card ID'),
		title: z
			.string()
			.max(80)
			.optional()
			.describe('New card title (max 80 chars). Should be action-oriented.'),
		description: z
			.string()
			.optional()
			.describe(
				'New card description (markdown supported). Use this to save the full brief or plan.',
			),
		addLabelIds: z
			.array(z.string())
			.optional()
			.describe('Label IDs to add to the card (e.g., for marking as processed)'),
	}),
	examples: [
		{
			params: {
				cardId: 'abc123',
				description: '## Context\n\nBackground info...\n\n## Requirements\n\n- Item 1\n- Item 2',
			},
			comment: 'Update the card description with a structured brief',
		},
		{
			params: {
				cardId: 'abc123',
				title: 'Add user authentication flow',
			},
			comment: 'Update just the card title',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return updateCard({
			cardId: params.cardId,
			title: params.title,
			description: params.description,
			addLabelIds: params.addLabelIds,
		});
	}
}

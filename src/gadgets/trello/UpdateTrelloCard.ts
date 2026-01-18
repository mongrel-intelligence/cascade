import { Gadget, z } from 'llmist';
import { trelloClient } from '../../trello/client.js';
import { formatGadgetError } from '../utils.js';

export class UpdateTrelloCard extends Gadget({
	name: 'UpdateTrelloCard',
	description:
		'Update a Trello card title and/or description. Use this to save your analysis, brief, or plan to the card.',
	timeoutMs: 30000,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
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
				comment: 'Saving structured brief to card',
				cardId: 'abc123',
				description: '## Context\n\nBackground info...\n\n## Requirements\n\n- Item 1\n- Item 2',
			},
			comment: 'Update the card description with a structured brief',
		},
		{
			params: {
				comment: 'Updating title to be more action-oriented',
				cardId: 'abc123',
				title: 'Add user authentication flow',
			},
			comment: 'Update just the card title',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		if (!params.title && !params.description && !params.addLabelIds?.length) {
			return 'Nothing to update - provide title, description, or labels';
		}

		try {
			// Update title/description if provided
			if (params.title || params.description) {
				await trelloClient.updateCard(params.cardId, {
					name: params.title,
					desc: params.description,
				});
			}

			// Add labels if provided
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
			return formatGadgetError('updating card', error);
		}
	}
}

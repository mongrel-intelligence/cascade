import { Gadget, z } from 'llmist';
import { updateChecklistItem } from './core/updateChecklistItem.js';

export class UpdateChecklistItem extends Gadget({
	name: 'UpdateChecklistItem',
	description:
		'Update a checklist item state on a Trello card. Use this to mark acceptance criteria as complete or incomplete.',
	timeoutMs: 15000,
	schema: z.object({
		cardId: z.string().describe('The Trello card ID'),
		checkItemId: z.string().describe('The checklist item ID to update'),
		state: z.enum(['complete', 'incomplete']).describe('The new state for the checklist item'),
	}),
	examples: [
		{
			params: {
				cardId: 'abc123',
				checkItemId: 'item456',
				state: 'complete',
			},
			comment: 'Mark an acceptance criterion as complete',
		},
		{
			params: {
				cardId: 'abc123',
				checkItemId: 'item789',
				state: 'incomplete',
			},
			comment: 'Mark an acceptance criterion as incomplete',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return updateChecklistItem(params.cardId, params.checkItemId, params.state);
	}
}

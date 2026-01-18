import { Gadget, z } from 'llmist';
import { trelloClient } from '../../trello/client.js';
import { formatGadgetError } from '../utils.js';

export class UpdateChecklistItem extends Gadget({
	name: 'UpdateChecklistItem',
	description:
		'Update a checklist item state on a Trello card. Use this to mark acceptance criteria as complete or incomplete.',
	timeoutMs: 15000,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		cardId: z.string().describe('The Trello card ID'),
		checkItemId: z.string().describe('The checklist item ID to update'),
		state: z.enum(['complete', 'incomplete']).describe('The new state for the checklist item'),
	}),
	examples: [
		{
			params: {
				comment: 'Marking criterion as done after implementing feature',
				cardId: 'abc123',
				checkItemId: 'item456',
				state: 'complete',
			},
			comment: 'Mark an acceptance criterion as complete',
		},
		{
			params: {
				comment: 'Reverting status - tests revealed issue',
				cardId: 'abc123',
				checkItemId: 'item789',
				state: 'incomplete',
			},
			comment: 'Mark an acceptance criterion as incomplete',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		try {
			await trelloClient.updateChecklistItem(params.cardId, params.checkItemId, params.state);

			const action = params.state === 'complete' ? 'marked complete' : 'marked incomplete';
			return `Checklist item ${params.checkItemId} ${action} on card ${params.cardId}`;
		} catch (error) {
			return formatGadgetError('updating checklist item', error);
		}
	}
}

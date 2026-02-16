import { Gadget, z } from 'llmist';
import { updateChecklistItem } from './core/updateChecklistItem.js';

export class PMUpdateChecklistItem extends Gadget({
	name: 'UpdateChecklistItem',
	description:
		'Update a checklist item state on a work item. Use this to mark items as complete or incomplete.',
	timeoutMs: 15000,
	schema: z.object({
		workItemId: z.string().describe('The work item ID (Trello card ID or JIRA issue key)'),
		checkItemId: z.string().describe('The checklist item ID to update'),
		complete: z.boolean().describe('Whether the item is complete'),
	}),
	examples: [
		{
			params: {
				workItemId: 'abc123',
				checkItemId: 'item456',
				complete: true,
			},
			comment: 'Mark an item as complete',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return updateChecklistItem(params.workItemId, params.checkItemId, params.complete);
	}
}

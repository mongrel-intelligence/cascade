import { Gadget, z } from 'llmist';
import { deleteChecklistItem } from './core/deleteChecklistItem.js';

export class PMDeleteChecklistItem extends Gadget({
	name: 'DeleteChecklistItem',
	description:
		'Delete a checklist item from a work item. For JIRA this deletes the subtask issue. For Trello this removes the checklist item. Use this to remove descoped or invalid plan steps — do NOT mark items as "complete" if they were never done.',
	timeoutMs: 15000,
	schema: z.object({
		workItemId: z.string().describe('The work item ID (Trello card ID or JIRA issue key)'),
		checkItemId: z
			.string()
			.describe('The checklist item ID to delete (JIRA subtask key or Trello check item ID)'),
	}),
	examples: [
		{
			params: {
				workItemId: 'PROJ-42',
				checkItemId: 'PROJ-48',
			},
			comment: 'Delete a descoped subtask from a JIRA issue',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return deleteChecklistItem(params.workItemId, params.checkItemId);
	}
}

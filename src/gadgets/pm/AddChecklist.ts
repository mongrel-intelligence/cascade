import { Gadget, z } from 'llmist';
import { addChecklist } from './core/addChecklist.js';

export class AddChecklist extends Gadget({
	name: 'AddChecklist',
	description:
		'Add a checklist with items to a work item. Use this to create interactive checklists for acceptance criteria or implementation steps.',
	timeoutMs: 30000,
	schema: z.object({
		workItemId: z.string().describe('The work item ID (Trello card ID or JIRA issue key)'),
		checklistName: z
			.string()
			.describe('Name of the checklist (e.g., "Acceptance Criteria" or "Implementation Steps")'),
		items: z.array(z.string()).min(1).describe('List of checklist items to add'),
	}),
	examples: [
		{
			params: {
				workItemId: 'abc123',
				checklistName: 'Implementation Steps',
				items: [
					'Add reset password endpoint to API',
					'Create email template for reset link',
					'Add password validation logic',
				],
			},
			comment: 'Add implementation steps checklist to a work item',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return addChecklist({
			workItemId: params.workItemId,
			checklistName: params.checklistName,
			items: params.items,
		});
	}
}

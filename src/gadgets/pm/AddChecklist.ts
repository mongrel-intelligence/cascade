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
		items: z
			.array(
				z.union([
					z.string(),
					z.object({
						name: z.string().describe('Checklist item name / subtask title'),
						description: z
							.string()
							.optional()
							.describe(
								'Detailed description (used as JIRA subtask description, ignored for Trello)',
							),
					}),
				]),
			)
			.min(1)
			.describe(
				'List of checklist items to add. Use objects with name+description for richer subtasks.',
			),
	}),
	examples: [
		{
			params: {
				workItemId: 'PROJ-42',
				checklistName: 'Implementation Steps',
				items: [
					{
						name: 'Add reset password endpoint to API',
						description:
							'**Files:** `src/api/auth.ts`\n- Add POST /auth/reset-password route\n- Validate email format and lookup user\n- Generate time-limited reset token',
					},
					{
						name: 'Create email template for reset link',
						description:
							'**Files:** `src/templates/reset-password.html`\n- Create responsive HTML email template\n- Include reset link with token parameter',
					},
				],
			},
			comment: 'Add implementation steps with descriptions to a JIRA issue',
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

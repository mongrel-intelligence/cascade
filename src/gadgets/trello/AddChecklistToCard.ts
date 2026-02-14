import { Gadget, z } from 'llmist';
import { addChecklist } from './core/addChecklist.js';

export class AddChecklistToCard extends Gadget({
	name: 'AddChecklistToCard',
	description:
		'Add a checklist with items to a Trello card. Use this to create interactive checklists for acceptance criteria or implementation steps.',
	timeoutMs: 30000,
	schema: z.object({
		cardId: z.string().describe('The Trello card ID'),
		checklistName: z
			.string()
			.describe(
				'Name of the checklist (e.g., "✅ Acceptance Criteria" or "📋 Implementation Steps")',
			),
		items: z.array(z.string()).min(1).describe('List of checklist items to add'),
	}),
	examples: [
		{
			params: {
				cardId: 'abc123',
				checklistName: '✅ Acceptance Criteria',
				items: [
					'User can request password reset via email',
					'Reset link expires after 24 hours',
					'User must set a new password meeting security requirements',
				],
			},
			comment: 'Add acceptance criteria checklist to a story card',
		},
		{
			params: {
				cardId: 'abc123',
				checklistName: '📋 Implementation Steps',
				items: [
					'Add reset password endpoint to API',
					'Create email template for reset link',
					'Add password validation logic',
				],
			},
			comment: 'Add implementation steps checklist to a story card',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return addChecklist({
			cardId: params.cardId,
			checklistName: params.checklistName,
			items: params.items,
		});
	}
}

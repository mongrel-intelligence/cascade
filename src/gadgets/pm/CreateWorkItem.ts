import { Gadget, z } from 'llmist';
import { createWorkItem } from './core/createWorkItem.js';

export class CreateWorkItem extends Gadget({
	name: 'CreateWorkItem',
	description:
		'Create a new work item (card/issue). Use this to create user story cards or break down work into smaller tasks.',
	timeoutMs: 30000,
	schema: z.object({
		containerId: z.string().describe('Container ID — Trello list ID or JIRA project key'),
		title: z.string().max(200).describe('Work item title'),
		description: z
			.string()
			.optional()
			.describe(
				'Description (markdown supported). Include acceptance criteria and technical notes.',
			),
	}),
	examples: [
		{
			params: {
				containerId: 'abc123',
				title: 'Add email validation to signup form',
				description: '## Acceptance Criteria\n\n- [ ] Email format is validated on blur',
			},
			comment: 'Create a new work item',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return createWorkItem({
			containerId: params.containerId,
			title: params.title,
			description: params.description,
		});
	}
}

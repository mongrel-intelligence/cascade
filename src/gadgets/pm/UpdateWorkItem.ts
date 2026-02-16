import { Gadget, z } from 'llmist';
import { updateWorkItem } from './core/updateWorkItem.js';

export class UpdateWorkItem extends Gadget({
	name: 'UpdateWorkItem',
	description:
		'Update a work item title and/or description. Use this to save your analysis, brief, or plan.',
	timeoutMs: 30000,
	schema: z.object({
		workItemId: z.string().describe('The work item ID (Trello card ID or JIRA issue key)'),
		title: z
			.string()
			.max(200)
			.optional()
			.describe('New title (max 200 chars). Should be action-oriented.'),
		description: z
			.string()
			.optional()
			.describe('New description (markdown supported). Use this to save the full brief or plan.'),
		addLabelIds: z.array(z.string()).optional().describe('Label IDs/names to add to the work item'),
	}),
	examples: [
		{
			params: {
				workItemId: 'abc123',
				description: '## Context\n\nBackground info...\n\n## Requirements\n\n- Item 1\n- Item 2',
			},
			comment: 'Update the description with a structured brief',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return updateWorkItem({
			workItemId: params.workItemId,
			title: params.title,
			description: params.description,
			addLabelIds: params.addLabelIds,
		});
	}
}

import { Gadget, z } from 'llmist';
import { readWorkItem } from './core/readWorkItem.js';

export class ReadWorkItem extends Gadget({
	name: 'ReadWorkItem',
	description:
		'Read a work item (card/issue) to retrieve its title, description, comments, checklists, and attachments. Use this to understand the current state before making changes.',
	timeoutMs: 30000,
	schema: z.object({
		workItemId: z.string().describe('The work item ID (Trello card ID or JIRA issue key)'),
		includeComments: z
			.boolean()
			.optional()
			.default(true)
			.describe('Whether to include comments in the response'),
	}),
	examples: [
		{
			params: { workItemId: 'abc123', includeComments: true },
			comment: 'Read the work item with its comments to understand context',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return readWorkItem(params.workItemId, params.includeComments);
	}
}

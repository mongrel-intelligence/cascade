import { Gadget, z } from 'llmist';
import { moveWorkItem } from './core/moveWorkItem.js';

export class MoveWorkItem extends Gadget({
	name: 'MoveWorkItem',
	description:
		'Move a work item to a different list or status. For Trello, the destination is a list ID. For JIRA, the destination is a status name (e.g. "To Do", "In Progress").',
	timeoutMs: 30000,
	schema: z.object({
		workItemId: z.string().describe('Work item ID (Trello card ID or JIRA issue key)'),
		destination: z.string().describe('Destination — Trello list ID or JIRA status name'),
	}),
	examples: [
		{
			params: {
				workItemId: 'abc123',
				destination: 'list456',
			},
			comment: 'Move a Trello card to a different list',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return moveWorkItem({
			workItemId: params.workItemId,
			destination: params.destination,
		});
	}
}

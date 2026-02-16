import { Gadget, z } from 'llmist';
import { listWorkItems } from './core/listWorkItems.js';

export class ListWorkItems extends Gadget({
	name: 'ListWorkItems',
	description:
		'List all work items in a container (Trello list or JIRA project). Use this to see items you created or to find items to update.',
	timeoutMs: 30000,
	schema: z.object({
		containerId: z.string().describe('Container ID — Trello list ID or JIRA project key'),
	}),
	examples: [
		{
			params: { containerId: 'abc123' },
			comment: 'List all work items to find ones to update',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return listWorkItems(params.containerId);
	}
}

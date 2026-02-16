import { Gadget, z } from 'llmist';
import { postComment } from './core/postComment.js';

export class PostComment extends Gadget({
	name: 'PostComment',
	description:
		'Post a comment to a work item (card/issue). Use this to communicate with the user, ask questions, or provide status updates.',
	timeoutMs: 30000,
	schema: z.object({
		workItemId: z.string().describe('The work item ID (Trello card ID or JIRA issue key)'),
		text: z.string().describe('The comment text to post (supports markdown)'),
	}),
	examples: [
		{
			params: {
				workItemId: 'abc123',
				text: '**Brief Ready for Review**\n\nI have analyzed the codebase and updated the description.',
			},
			comment: 'Post a status update to the work item',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return postComment(params.workItemId, params.text);
	}
}

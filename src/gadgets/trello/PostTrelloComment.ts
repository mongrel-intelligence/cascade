import { Gadget, z } from 'llmist';
import { postComment } from './core/postComment.js';

export class PostTrelloComment extends Gadget({
	name: 'PostTrelloComment',
	description:
		'Post a comment to a Trello card. Use this to communicate with the user, ask questions, or provide status updates.',
	timeoutMs: 30000,
	schema: z.object({
		cardId: z.string().describe('The Trello card ID'),
		text: z.string().describe('The comment text to post (supports markdown)'),
	}),
	examples: [
		{
			params: {
				cardId: 'abc123',
				text: '📋 **Brief Ready for Review**\n\nI have analyzed the codebase and updated the card description.',
			},
			comment: 'Post a status update to the card',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return postComment(params.cardId, params.text);
	}
}

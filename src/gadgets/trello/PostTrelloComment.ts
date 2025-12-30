import { z } from 'zod';
import { trelloClient } from '../../trello/client.js';

export const PostTrelloCommentSchema = z.object({
	cardId: z.string().describe('The Trello card ID'),
	comment: z.string().describe('The comment text to post (supports markdown)'),
});

export type PostTrelloCommentParams = z.infer<typeof PostTrelloCommentSchema>;

export const PostTrelloCommentGadget = {
	name: 'PostTrelloComment',
	description: 'Post a comment to a Trello card. Use this to communicate with the user.',
	schema: PostTrelloCommentSchema,

	async execute(params: PostTrelloCommentParams): Promise<string> {
		await trelloClient.addComment(params.cardId, params.comment);
		return 'Comment posted successfully';
	},
};

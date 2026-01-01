import { Gadget, z } from 'llmist';
import { githubClient } from '../../github/client.js';

export class ReplyToReviewComment extends Gadget({
	name: 'ReplyToReviewComment',
	description:
		'Reply to a specific review comment on a GitHub pull request. Use this to acknowledge feedback and explain what was fixed.',
	timeoutMs: 30000,
	schema: z.object({
		owner: z.string().describe('The repository owner (username or organization)'),
		repo: z.string().describe('The repository name'),
		prNumber: z.number().describe('The pull request number'),
		commentId: z.number().describe('The ID of the comment to reply to'),
		body: z.string().describe('The reply message (supports markdown)'),
	}),
	examples: [
		{
			params: {
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
				commentId: 123456,
				body: 'Fixed! I updated the function to handle edge cases properly.',
			},
			comment: 'Reply to review comment explaining the fix',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		try {
			const reply = await githubClient.replyToReviewComment(
				params.owner,
				params.repo,
				params.prNumber,
				params.commentId,
				params.body,
			);
			return `Reply posted successfully: ${reply.htmlUrl}`;
		} catch (error) {
			return `Error replying to comment: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}

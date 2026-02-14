import { Gadget, z } from 'llmist';
import { replyToReviewComment } from './core/replyToReviewComment.js';

export class ReplyToReviewComment extends Gadget({
	name: 'ReplyToReviewComment',
	description:
		'Reply to a specific review comment on a GitHub pull request. Use this to acknowledge feedback and explain what was fixed.',
	timeoutMs: 30000,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		owner: z.string().describe('The repository owner (username or organization)'),
		repo: z.string().describe('The repository name'),
		prNumber: z.number().describe('The pull request number'),
		commentId: z.number().describe('The ID of the comment to reply to'),
		body: z.string().describe('The reply message (supports markdown)'),
	}),
	examples: [
		{
			params: {
				comment: 'Responding to review feedback about edge cases',
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
		return replyToReviewComment(
			params.owner,
			params.repo,
			params.prNumber,
			params.commentId,
			params.body,
		);
	}
}

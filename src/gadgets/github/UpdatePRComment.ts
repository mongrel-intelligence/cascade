import { Gadget, z } from 'llmist';
import { updatePRComment } from './core/updatePRComment.js';

export class UpdatePRComment extends Gadget({
	name: 'UpdatePRComment',
	description:
		'Update an existing comment on a GitHub pull request. Use this to update a previously posted comment with new information.',
	timeoutMs: 30000,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		owner: z.string().describe('The repository owner (username or organization)'),
		repo: z.string().describe('The repository name'),
		commentId: z.number().describe('The ID of the comment to update'),
		body: z.string().describe('The new comment body (supports markdown)'),
	}),
	examples: [
		{
			params: {
				comment: 'Updating status after addressing feedback',
				owner: 'acme',
				repo: 'myapp',
				commentId: 123456789,
				body: '✅ All review feedback has been addressed. Changes pushed.',
			},
			comment: 'Update an existing comment with completion status',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return updatePRComment(params.owner, params.repo, params.commentId, params.body);
	}
}

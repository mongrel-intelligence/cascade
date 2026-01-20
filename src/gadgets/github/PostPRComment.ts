import { Gadget, z } from 'llmist';
import { githubClient } from '../../github/client.js';
import { formatGadgetError } from '../utils.js';

export class PostPRComment extends Gadget({
	name: 'PostPRComment',
	description:
		'Post a comment on a GitHub pull request. Use this for general PR comments (not replies to review comments).',
	timeoutMs: 30000,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		owner: z.string().describe('The repository owner (username or organization)'),
		repo: z.string().describe('The repository name'),
		prNumber: z.number().describe('The pull request number'),
		body: z.string().describe('The comment body (supports markdown)'),
	}),
	examples: [
		{
			params: {
				comment: 'Acknowledging review feedback',
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
				body: '🤖 Working on addressing the review feedback...',
			},
			comment: 'Post a status comment on the PR',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		try {
			const result = await githubClient.createPRComment(
				params.owner,
				params.repo,
				params.prNumber,
				params.body,
			);
			return `Comment posted (id: ${result.id}): ${result.htmlUrl}`;
		} catch (error) {
			return formatGadgetError('posting PR comment', error);
		}
	}
}

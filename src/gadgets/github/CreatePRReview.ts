import { Gadget, z } from 'llmist';
import { githubClient } from '../../github/client.js';
import { formatGadgetError } from '../utils.js';

export class CreatePRReview extends Gadget({
	name: 'CreatePRReview',
	description:
		'Submit a code review on a GitHub pull request. Use this to approve, request changes, or comment on the PR.',
	timeoutMs: 30000,
	schema: z.object({
		owner: z.string().describe('The repository owner (username or organization)'),
		repo: z.string().describe('The repository name'),
		prNumber: z.number().describe('The pull request number'),
		event: z
			.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT'])
			.describe('The review action: APPROVE, REQUEST_CHANGES, or COMMENT'),
		body: z.string().describe('Overall review summary (supports markdown)'),
		comments: z
			.array(
				z.object({
					path: z.string().describe('The relative path to the file being commented on'),
					line: z.number().optional().describe('The line number in the file to comment on'),
					body: z.string().describe('The comment text (supports markdown)'),
				}),
			)
			.optional()
			.describe('Optional inline comments on specific files/lines'),
	}),
	examples: [
		{
			params: {
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
				event: 'APPROVE',
				body: 'LGTM! The implementation is clean and well-tested.',
			},
			comment: 'Approve a PR with a summary',
		},
		{
			params: {
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
				event: 'REQUEST_CHANGES',
				body: 'Good progress, but a few issues need to be addressed before merging.',
				comments: [
					{
						path: 'src/utils.ts',
						line: 15,
						body: 'This could cause a null pointer exception. Please add a null check.',
					},
				],
			},
			comment: 'Request changes with inline comments',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		try {
			const review = await githubClient.createPRReview(
				params.owner,
				params.repo,
				params.prNumber,
				params.event,
				params.body,
				params.comments,
			);
			return `Review submitted successfully (${params.event}): ${review.htmlUrl}`;
		} catch (error) {
			return formatGadgetError('submitting review', error);
		}
	}
}

import { Gadget, z } from 'llmist';
import { deleteInitialComment, recordReviewSubmission } from '../sessionState.js';
import { formatGadgetError } from '../utils.js';
import { createPRReview } from './core/createPRReview.js';

export class CreatePRReview extends Gadget({
	name: 'CreatePRReview',
	description:
		'Submit a code review on a GitHub pull request. Use this to approve, request changes, or comment on the PR.',
	timeoutMs: 30000,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
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
				comment: 'Approving PR after thorough review',
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
				comment: 'Requesting changes for identified issues',
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
			const result = await createPRReview({
				owner: params.owner,
				repo: params.repo,
				prNumber: params.prNumber,
				event: params.event,
				body: params.body,
				comments: params.comments,
			});
			recordReviewSubmission(result.reviewUrl, params.body, result.event);
			// Delete the stale ack/progress comment immediately after review submission.
			// Best-effort: wrapped in deleteInitialComment's own try-catch.
			await deleteInitialComment(params.owner, params.repo);
			return `Review submitted successfully (${result.event}): ${result.reviewUrl}`;
		} catch (error) {
			const baseError = formatGadgetError('submitting review', error);

			if (params.comments?.length) {
				const paths = params.comments.map((c) => `  - ${c.path}:${c.line ?? 'general'}`).join('\n');
				return `${baseError}\n\nComment paths attempted:\n${paths}`;
			}

			return baseError;
		}
	}
}

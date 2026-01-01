import { Gadget, z } from 'llmist';
import { githubClient } from '../../github/client.js';

export class GetPRComments extends Gadget({
	name: 'GetPRComments',
	description:
		'Get all review comments on a GitHub pull request. Use this to understand what feedback has been given.',
	timeoutMs: 30000,
	schema: z.object({
		owner: z.string().describe('The repository owner (username or organization)'),
		repo: z.string().describe('The repository name'),
		prNumber: z.number().describe('The pull request number'),
	}),
	examples: [
		{
			params: {
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
			},
			comment: 'Get all review comments on PR #42',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		try {
			const comments = await githubClient.getPRReviewComments(
				params.owner,
				params.repo,
				params.prNumber,
			);

			if (comments.length === 0) {
				return 'No review comments found on this PR.';
			}

			const formatted = comments.map((c) => {
				const lines = [
					`Comment #${c.id} by @${c.user.login}`,
					`File: ${c.path}${c.line ? `:${c.line}` : ''}`,
					`URL: ${c.htmlUrl}`,
					c.inReplyToId ? `In reply to: #${c.inReplyToId}` : null,
					'',
					c.body,
					'---',
				]
					.filter(Boolean)
					.join('\n');
				return lines;
			});

			return `Found ${comments.length} review comment(s):\n\n${formatted.join('\n')}`;
		} catch (error) {
			return `Error fetching PR comments: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}

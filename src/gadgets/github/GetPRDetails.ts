import { Gadget, z } from 'llmist';
import { githubClient } from '../../github/client.js';

export class GetPRDetails extends Gadget({
	name: 'GetPRDetails',
	description:
		'Get details about a GitHub pull request including title, description, and branch info.',
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
			comment: 'Get details for PR #42',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		try {
			const pr = await githubClient.getPR(params.owner, params.repo, params.prNumber);

			return [
				`PR #${pr.number}: ${pr.title}`,
				`State: ${pr.state}`,
				`Branch: ${pr.headRef} -> ${pr.baseRef}`,
				`URL: ${pr.htmlUrl}`,
				'',
				'Description:',
				pr.body || '(no description)',
			].join('\n');
		} catch (error) {
			return `Error fetching PR details: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}

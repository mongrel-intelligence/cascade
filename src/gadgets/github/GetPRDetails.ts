import { Gadget, z } from 'llmist';
import { getPRDetails } from './core/getPRDetails.js';

export class GetPRDetails extends Gadget({
	name: 'GetPRDetails',
	description:
		'Get details about a GitHub pull request including title, description, and branch info.',
	timeoutMs: 30000,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		owner: z.string().describe('The repository owner (username or organization)'),
		repo: z.string().describe('The repository name'),
		prNumber: z.number().describe('The pull request number'),
	}),
	examples: [
		{
			params: {
				comment: 'Fetching PR details to understand changes',
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
			},
			comment: 'Get details for PR #42',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return getPRDetails(params.owner, params.repo, params.prNumber);
	}
}

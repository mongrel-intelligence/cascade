import { Gadget, z } from 'llmist';
import { getPRComments } from './core/getPRComments.js';

export class GetPRComments extends Gadget({
	name: 'GetPRComments',
	description:
		'Get all review comments on a GitHub pull request. Use this to understand what feedback has been given.',
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
				comment: 'Fetching review comments to understand feedback',
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
			},
			comment: 'Get all review comments on PR #42',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return getPRComments(params.owner, params.repo, params.prNumber);
	}
}

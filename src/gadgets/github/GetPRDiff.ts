import { Gadget, z } from 'llmist';
import { getPRDiff } from './core/getPRDiff.js';

export class GetPRDiff extends Gadget({
	name: 'GetPRDiff',
	description:
		'Get the unified diff of all file changes in a GitHub pull request. Shows each file with additions, deletions, and the patch content.',
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
				comment: 'Reviewing file changes for code review',
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
			},
			comment: 'Get all file changes in PR #42',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return getPRDiff(params.owner, params.repo, params.prNumber);
	}
}

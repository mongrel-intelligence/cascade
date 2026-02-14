import { Gadget, z } from 'llmist';
import { formatCheckStatus, getPRChecks } from './core/getPRChecks.js';

// Re-export formatCheckStatus for use by synthetic calls
export { formatCheckStatus };

export class GetPRChecks extends Gadget({
	name: 'GetPRChecks',
	description:
		'Get the CI check status for a GitHub pull request. Shows all workflow runs and their status/conclusion.',
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
				comment: 'Checking CI status before merge',
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
			},
			comment: 'Get CI check status for PR #42',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return getPRChecks(params.owner, params.repo, params.prNumber);
	}
}

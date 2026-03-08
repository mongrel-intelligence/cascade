import { Gadget, z } from 'llmist';
import { getCIRunLogs } from './core/getCIRunLogs.js';

export class GetCIRunLogs extends Gadget({
	name: 'GetCIRunLogs',
	description:
		'Get failed CI workflow run info for a given commit ref. Shows failed jobs and failed steps. Use Tmux to run specific commands locally for detailed error output.',
	timeoutMs: 60000,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		owner: z.string().describe('The repository owner (username or organization)'),
		repo: z.string().describe('The repository name'),
		ref: z.string().describe('The commit SHA (head SHA of the PR)'),
	}),
	examples: [
		{
			params: {
				comment: 'Fetching failed CI logs to diagnose test failures',
				owner: 'acme',
				repo: 'myapp',
				ref: 'abc1234567890',
			},
			comment: 'Get failed CI run logs for the PR head commit',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return getCIRunLogs(params.owner, params.repo, params.ref);
	}
}

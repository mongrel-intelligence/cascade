import { Gadget, z } from 'llmist';
import { githubClient } from '../../github/client.js';
import { formatGadgetError } from '../utils.js';

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
		try {
			const files = await githubClient.getPRDiff(params.owner, params.repo, params.prNumber);

			if (files.length === 0) {
				return 'No files changed in this PR.';
			}

			const formatted = files.map((f) => {
				const lines = [`## ${f.filename}`, `Status: ${f.status} | +${f.additions} -${f.deletions}`];
				if (f.patch) {
					lines.push('```diff', f.patch, '```');
				} else {
					lines.push('[Binary file or too large to display]');
				}
				return lines.join('\n');
			});

			return `${files.length} file(s) changed:\n\n${formatted.join('\n\n')}`;
		} catch (error) {
			return formatGadgetError('fetching PR diff', error);
		}
	}
}

import { z } from 'zod';
import { logger } from '../../utils/logging.js';
import { runCommand } from '../../utils/repo.js';

export const CreatePRSchema = z.object({
	title: z.string().describe('PR title'),
	body: z.string().describe('PR body/description'),
	baseBranch: z.string().describe('Target branch for the PR'),
	draft: z.boolean().default(false).describe('Create as draft PR'),
});

export type CreatePRParams = z.infer<typeof CreatePRSchema>;

export const CreatePRGadget = {
	name: 'CreatePR',
	description: 'Create a GitHub Pull Request using the gh CLI',
	schema: CreatePRSchema,

	async execute(params: CreatePRParams, cwd: string): Promise<string> {
		logger.debug('Creating PR', { title: params.title, baseBranch: params.baseBranch, cwd });

		const args = [
			'pr',
			'create',
			'--title',
			params.title,
			'--body',
			params.body,
			'--base',
			params.baseBranch,
		];

		if (params.draft) {
			args.push('--draft');
		}

		const result = await runCommand('gh', args, cwd);

		if (result.exitCode !== 0) {
			throw new Error(`Failed to create PR: ${result.stderr}`);
		}

		// Extract PR URL from output
		const prUrlMatch = result.stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
		if (prUrlMatch) {
			return prUrlMatch[0];
		}

		return result.stdout.trim();
	},
};

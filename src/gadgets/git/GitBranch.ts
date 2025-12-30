import { z } from 'zod';
import { logger } from '../../utils/logging.js';
import { runCommand } from '../../utils/repo.js';

export const GitBranchSchema = z.object({
	branchName: z.string().describe('Name of the branch to create'),
	baseBranch: z
		.string()
		.optional()
		.describe('Base branch to create from (default: current branch)'),
});

export type GitBranchParams = z.infer<typeof GitBranchSchema>;

export const GitBranchGadget = {
	name: 'GitBranch',
	description: 'Create and checkout a new git branch from the current or specified base branch',
	schema: GitBranchSchema,

	async execute(params: GitBranchParams, cwd: string): Promise<string> {
		logger.debug('Creating git branch', { branchName: params.branchName, cwd });

		// Fetch latest
		await runCommand('git', ['fetch', 'origin'], cwd);

		// Checkout base branch if specified
		if (params.baseBranch) {
			const checkoutResult = await runCommand('git', ['checkout', params.baseBranch], cwd);
			if (checkoutResult.exitCode !== 0) {
				throw new Error(`Failed to checkout base branch: ${checkoutResult.stderr}`);
			}

			// Pull latest
			await runCommand('git', ['pull', 'origin', params.baseBranch], cwd);
		}

		// Create and checkout new branch
		const result = await runCommand('git', ['checkout', '-b', params.branchName], cwd);

		if (result.exitCode !== 0) {
			throw new Error(`Failed to create branch: ${result.stderr}`);
		}

		return `Created and checked out branch: ${params.branchName}`;
	},
};

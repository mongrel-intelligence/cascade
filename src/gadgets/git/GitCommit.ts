import { z } from 'zod';
import { logger } from '../../utils/logging.js';
import { runCommand } from '../../utils/repo.js';

export const GitCommitSchema = z.object({
	message: z.string().describe('Commit message'),
	files: z.array(z.string()).optional().describe('Files to stage (default: all changes)'),
});

export type GitCommitParams = z.infer<typeof GitCommitSchema>;

export const GitCommitGadget = {
	name: 'GitCommit',
	description: 'Stage files and create a git commit',
	schema: GitCommitSchema,

	async execute(params: GitCommitParams, cwd: string): Promise<string> {
		logger.debug('Creating git commit', { message: params.message, cwd });

		// Stage files
		if (params.files && params.files.length > 0) {
			for (const file of params.files) {
				await runCommand('git', ['add', file], cwd);
			}
		} else {
			await runCommand('git', ['add', '-A'], cwd);
		}

		// Check if there are changes to commit
		const statusResult = await runCommand('git', ['status', '--porcelain'], cwd);
		if (!statusResult.stdout.trim()) {
			return 'No changes to commit';
		}

		// Commit
		const result = await runCommand('git', ['commit', '-m', params.message], cwd);

		if (result.exitCode !== 0) {
			throw new Error(`Failed to commit: ${result.stderr}`);
		}

		return `Committed: ${params.message}`;
	},
};

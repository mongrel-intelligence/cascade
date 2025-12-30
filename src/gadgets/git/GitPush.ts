import { z } from 'zod';
import { logger } from '../../utils/logging.js';
import { runCommand } from '../../utils/repo.js';

export const GitPushSchema = z.object({
	setUpstream: z.boolean().default(true).describe('Set upstream tracking (-u flag)'),
});

export type GitPushParams = z.infer<typeof GitPushSchema>;

export const GitPushGadget = {
	name: 'GitPush',
	description: 'Push the current branch to the remote repository',
	schema: GitPushSchema,

	async execute(params: GitPushParams, cwd: string): Promise<string> {
		logger.debug('Pushing to remote', { setUpstream: params.setUpstream, cwd });

		const args = ['push'];
		if (params.setUpstream) {
			args.push('-u', 'origin', 'HEAD');
		}

		const result = await runCommand('git', args, cwd);

		if (result.exitCode !== 0) {
			throw new Error(`Failed to push: ${result.stderr}`);
		}

		return 'Pushed to remote successfully';
	},
};

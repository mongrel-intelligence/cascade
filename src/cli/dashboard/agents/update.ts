import { Args, Flags } from '@oclif/core';
import type { ReviewEventPolicy } from '../../../config/reviewEventPolicy.js';
import type { UpdateChannel } from '../../../config/updateChannel.js';
import { DashboardCommand } from '../_shared/base.js';

export default class AgentsUpdate extends DashboardCommand {
	static override description = 'Update an agent configuration.';

	static override args = {
		id: Args.integer({ description: 'Agent config ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		'agent-type': Flags.string({ description: 'Agent type' }),
		model: Flags.string({ description: 'Model override' }),
		'max-iterations': Flags.integer({ description: 'Max iterations override' }),
		engine: Flags.string({ description: 'Agent engine override' }),
		'max-concurrency': Flags.integer({ description: 'Max concurrent runs per project' }),
		'update-channel': Flags.string({
			description: 'Where this agent posts status updates',
			options: ['none', 'scm-only', 'pm-only', 'both'],
		}),
		'review-event-policy': Flags.string({
			description:
				'Which PR review verdicts the agent may submit (comment-only downgrades every review to an advisory comment)',
			options: ['all', 'comment-only'],
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(AgentsUpdate);

		try {
			await this.withSpinner('Updating agent config...', () =>
				this.client.agentConfigs.update.mutate({
					id: args.id,
					agentType: flags['agent-type'],
					model: flags.model,
					maxIterations: flags['max-iterations'],
					agentEngine: flags.engine,
					maxConcurrency: flags['max-concurrency'],
					updateChannel: flags['update-channel'] as UpdateChannel | undefined,
					reviewEventPolicy: flags['review-event-policy'] as ReviewEventPolicy | undefined,
				}),
			);

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.success(`Updated agent config #${args.id}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}

import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class AgentsCreate extends DashboardCommand {
	static override description = 'Create an agent configuration.';

	static override flags = {
		...DashboardCommand.baseFlags,
		'agent-type': Flags.string({
			description: 'Agent type (e.g. implementation, review)',
			required: true,
		}),
		'project-id': Flags.string({ description: 'Scope to specific project' }),
		model: Flags.string({ description: 'Model override' }),
		'max-iterations': Flags.integer({ description: 'Max iterations override' }),
		backend: Flags.string({ description: 'Agent backend override' }),
		prompt: Flags.string({ description: 'Custom prompt override' }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(AgentsCreate);

		try {
			const result = await this.client.agentConfigs.create.mutate({
				agentType: flags['agent-type'],
				projectId: flags['project-id'],
				model: flags.model,
				maxIterations: flags['max-iterations'],
				agentBackend: flags.backend,
				prompt: flags.prompt,
			});

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.log(`Created agent config for ${flags['agent-type']}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}

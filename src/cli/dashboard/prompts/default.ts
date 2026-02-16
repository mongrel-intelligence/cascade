import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class PromptsDefault extends DashboardCommand {
	static override description = 'Print the default .eta template for an agent type.';

	static override flags = {
		...DashboardCommand.baseFlags,
		'agent-type': Flags.string({
			description: 'Agent type (e.g. implementation, review)',
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(PromptsDefault);

		try {
			const result = await this.client.prompts.getDefault.query({
				agentType: flags['agent-type'],
			});

			// Print raw template to stdout (for piping)
			process.stdout.write(result.content);
		} catch (err) {
			this.handleError(err);
		}
	}
}

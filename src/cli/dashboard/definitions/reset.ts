import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class DefinitionsReset extends DashboardCommand {
	static override description = 'Restore a builtin agent definition to its YAML default.';

	static override args = {
		agentType: Args.string({ description: 'Agent type', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		yes: Flags.boolean({ description: 'Skip confirmation', char: 'y', default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(DefinitionsReset);

		if (!flags.yes) {
			this.error('Pass --yes to confirm reset.');
		}

		try {
			const result = await this.client.agentDefinitions.reset.mutate({
				agentType: args.agentType,
			});

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.log(`Reset agent definition to YAML default: ${result.agentType}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}

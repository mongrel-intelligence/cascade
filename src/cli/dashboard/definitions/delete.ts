import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class DefinitionsDelete extends DashboardCommand {
	static override description = 'Delete a non-builtin agent definition.';

	static override args = {
		agentType: Args.string({ description: 'Agent type', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		yes: Flags.boolean({ description: 'Skip confirmation', char: 'y', default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(DefinitionsDelete);

		if (!flags.yes) {
			this.error('Pass --yes to confirm deletion.');
		}

		try {
			const result = await this.client.agentDefinitions.delete.mutate({
				agentType: args.agentType,
			});

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.log(`Deleted agent definition: ${result.agentType}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}

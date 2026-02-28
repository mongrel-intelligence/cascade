import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class DefinitionsShow extends DashboardCommand {
	static override description = 'Show details of an agent definition.';

	static override args = {
		agentType: Args.string({ description: 'Agent type', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(DefinitionsShow);

		try {
			const result = await this.client.agentDefinitions.get.query({
				agentType: args.agentType,
			});

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.log(`Agent Type: ${result.agentType}`);
			this.log(`Built-in:   ${result.isBuiltin ? 'yes' : 'no'}`);
			this.log(`Label:      ${result.definition.identity.label}`);
			this.log(`Emoji:      ${result.definition.identity.emoji}`);
			this.log(`Role Hint:  ${result.definition.identity.roleHint}`);
			this.log('');
			this.log('Definition:');
			this.log(JSON.stringify(result.definition, null, 2));
		} catch (err) {
			this.handleError(err);
		}
	}
}

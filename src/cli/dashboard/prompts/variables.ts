import { DashboardCommand } from '../_shared/base.js';

export default class PromptsVariables extends DashboardCommand {
	static override description = 'List available template variables.';

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(PromptsVariables);

		try {
			const variables = await this.client.prompts.variables.query();

			if (flags.json) {
				this.outputJson(variables);
				return;
			}

			this.outputTable(variables as unknown as Record<string, unknown>[], [
				{ key: 'name', header: 'Variable' },
				{ key: 'group', header: 'Group' },
				{ key: 'description', header: 'Description' },
			]);
		} catch (err) {
			this.handleError(err);
		}
	}
}

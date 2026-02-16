import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class PromptsDefaultPartial extends DashboardCommand {
	static override description = 'Print the disk-based default partial content.';

	static override flags = {
		...DashboardCommand.baseFlags,
		name: Flags.string({
			description: 'Partial name (e.g. git, tmux, test-protocol)',
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(PromptsDefaultPartial);

		try {
			const result = await this.client.prompts.getDefaultPartial.query({
				name: flags.name,
			});
			process.stdout.write(result.content);
		} catch (err) {
			this.handleError(err);
		}
	}
}

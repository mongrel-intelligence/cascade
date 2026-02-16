import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class PromptsGetPartial extends DashboardCommand {
	static override description = 'Print a partial (DB content or disk fallback).';

	static override flags = {
		...DashboardCommand.baseFlags,
		name: Flags.string({
			description: 'Partial name (e.g. git, tmux, test-protocol)',
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(PromptsGetPartial);

		try {
			const result = await this.client.prompts.getPartial.query({ name: flags.name });
			process.stdout.write(result.content);
		} catch (err) {
			this.handleError(err);
		}
	}
}

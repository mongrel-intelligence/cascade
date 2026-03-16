import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class PromptsResetPartial extends DashboardCommand {
	static override description = 'Delete a DB partial (revert to disk default).';

	static override flags = {
		...DashboardCommand.baseFlags,
		name: Flags.string({
			description: 'Partial name to reset',
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(PromptsResetPartial);

		try {
			// Get the partial to find its ID
			const partial = await this.client.prompts.getPartial.query({ name: flags.name });

			if (partial.source === 'disk') {
				this.log(`Partial '${flags.name}' is already using disk default.`);
				return;
			}

			if (partial.id == null) {
				this.error(`Cannot determine partial ID for "${flags.name}".`);
			}

			await this.withSpinner('Resetting partial...', () =>
				this.client.prompts.deletePartial.mutate({ id: partial.id as number }),
			);

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.success(`Reset partial '${flags.name}' to disk default`);
		} catch (err) {
			this.handleError(err);
		}
	}
}

import { readFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class PromptsSetPartial extends DashboardCommand {
	static override description = 'Create or update a partial from a file.';

	static override flags = {
		...DashboardCommand.baseFlags,
		name: Flags.string({
			description: 'Partial name (e.g. git, tmux, test-protocol)',
			required: true,
		}),
		file: Flags.string({
			description: 'Path to partial file (use - for stdin)',
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(PromptsSetPartial);

		try {
			const content =
				flags.file === '-' ? readFileSync(0, 'utf-8') : readFileSync(flags.file, 'utf-8');

			const result = await this.withSpinner('Saving partial...', () =>
				this.client.prompts.upsertPartial.mutate({
					name: flags.name,
					content,
				}),
			);

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.success(`Saved partial '${flags.name}' (id: ${result.id})`);
		} catch (err) {
			this.handleError(err);
		}
	}
}

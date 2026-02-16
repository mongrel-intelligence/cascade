import { readFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class PromptsValidate extends DashboardCommand {
	static override description = 'Validate a prompt template file.';

	static override flags = {
		...DashboardCommand.baseFlags,
		file: Flags.string({
			description: 'Path to template file (use - for stdin)',
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(PromptsValidate);

		try {
			const template =
				flags.file === '-' ? readFileSync(0, 'utf-8') : readFileSync(flags.file, 'utf-8');

			const result = await this.client.prompts.validate.mutate({ template });

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			if (result.valid) {
				this.log('Template is valid.');
			} else {
				this.error(`Template invalid: ${result.error}`);
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}

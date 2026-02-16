import { DashboardCommand } from '../_shared/base.js';

export default class PromptsListPartials extends DashboardCommand {
	static override description = 'List all prompt partials (DB and disk).';

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(PromptsListPartials);

		try {
			const partials = await this.client.prompts.listPartials.query();

			if (flags.json) {
				this.outputJson(partials);
				return;
			}

			this.outputTable(partials as unknown as Record<string, unknown>[], [
				{ key: 'name', header: 'Name' },
				{ key: 'source', header: 'Source' },
				{ key: 'lines', header: 'Lines' },
			]);
		} catch (err) {
			this.handleError(err);
		}
	}
}

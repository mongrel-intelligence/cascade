import { DashboardCommand } from '../_shared/base.js';

export default class DefinitionsList extends DashboardCommand {
	static override description = 'List all agent definitions.';

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(DefinitionsList);

		try {
			const definitions = await this.client.agentDefinitions.list.query();

			if (flags.json) {
				this.outputJson(definitions);
				return;
			}

			this.outputTable(
				definitions.map((d) => ({
					agentType: d.agentType,
					label: d.definition.identity.label,
					emoji: d.definition.identity.emoji,
					isBuiltin: d.isBuiltin,
				})),
				[
					{ key: 'agentType', header: 'Agent Type' },
					{ key: 'label', header: 'Label' },
					{ key: 'emoji', header: 'Emoji' },
					{
						key: 'isBuiltin',
						header: 'Built-in',
						format: (v) => (v ? 'yes' : 'no'),
					},
				],
			);
		} catch (err) {
			this.handleError(err);
		}
	}
}

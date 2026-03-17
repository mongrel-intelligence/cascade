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

			const rows = definitions.map((d) => ({
				agentType: d.agentType,
				label: d.definition.identity.label,
				emoji: d.definition.identity.emoji,
				isBuiltin: d.isBuiltin,
			}));

			const columns = [
				{ key: 'agentType', header: 'Agent Type' },
				{ key: 'label', header: 'Label' },
				{ key: 'emoji', header: 'Emoji' },
				{
					key: 'isBuiltin',
					header: 'Built-in',
					format: (v: unknown) => (v ? 'yes' : 'no'),
				},
			];

			this.outputFormatted(
				rows,
				columns,
				flags,
				definitions,
				'No agent definitions found. Import one with: cascade definitions import --file <definition.yaml>',
			);
		} catch (err) {
			this.handleError(err);
		}
	}
}

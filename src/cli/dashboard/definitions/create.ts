import { readFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class DefinitionsCreate extends DashboardCommand {
	static override description = 'Create a new agent definition from a JSON or YAML file.';

	static override flags = {
		...DashboardCommand.baseFlags,
		'agent-type': Flags.string({
			description: 'Agent type identifier (e.g. my-custom-agent)',
			required: true,
		}),
		file: Flags.string({
			description: 'Path to JSON or YAML definition file (use - for stdin)',
			char: 'f',
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(DefinitionsCreate);

		try {
			const raw = flags.file === '-' ? readFileSync(0, 'utf-8') : readFileSync(flags.file, 'utf-8');

			let definition: unknown;
			const trimmed = raw.trim();
			if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
				// JSON
				definition = JSON.parse(raw);
			} else {
				// YAML — dynamic import to avoid bundling issues
				const yaml = await import('js-yaml');
				definition = yaml.load(raw);
			}

			const result = await this.withSpinner('Creating agent definition...', () =>
				this.client.agentDefinitions.create.mutate({
					agentType: flags['agent-type'],
					definition: definition as Parameters<
						typeof this.client.agentDefinitions.create.mutate
					>[0]['definition'],
				}),
			);

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.success(`Created agent definition '${result.agentType}'`);
		} catch (err) {
			this.handleError(err);
		}
	}
}

import { readFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class DefinitionsUpdate extends DashboardCommand {
	static override description =
		'Apply partial updates to an agent definition from a JSON or YAML file.';

	static override args = {
		agentType: Args.string({ description: 'Agent type', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		file: Flags.string({
			description: 'Path to JSON or YAML patch file (use - for stdin)',
			char: 'f',
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(DefinitionsUpdate);

		try {
			const raw = flags.file === '-' ? readFileSync(0, 'utf-8') : readFileSync(flags.file, 'utf-8');

			let patch: unknown;
			const trimmed = raw.trim();
			if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
				// JSON
				patch = JSON.parse(raw);
			} else {
				// YAML — dynamic import to avoid bundling issues
				const yaml = await import('js-yaml');
				patch = yaml.load(raw);
			}

			const result = await this.withSpinner('Updating agent definition...', () =>
				this.client.agentDefinitions.update.mutate({
					agentType: args.agentType,
					patch: patch as Parameters<typeof this.client.agentDefinitions.update.mutate>[0]['patch'],
				}),
			);

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.success(`Updated agent definition '${result.agentType}'`);
		} catch (err) {
			this.handleError(err);
		}
	}
}

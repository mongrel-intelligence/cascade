import { writeFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class DefinitionsExport extends DashboardCommand {
	static override description =
		'Export one or all agent definitions as JSON or YAML to stdout or a file.';

	static override args = {
		agentType: Args.string({ description: 'Agent type to export (omit to export all)' }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		format: Flags.string({
			description: 'Output format: json or yaml',
			options: ['json', 'yaml'],
			default: 'json',
		}),
		output: Flags.string({
			description: 'Output file path (default: stdout)',
			char: 'o',
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(DefinitionsExport);

		try {
			let data: unknown;

			if (args.agentType) {
				// Export single definition
				const result = await this.client.agentDefinitions.get.query({
					agentType: args.agentType,
				});
				data = result;
			} else {
				// Export all definitions
				const results = await this.client.agentDefinitions.list.query();
				data = results;
			}

			let output: string;
			if (flags.format === 'yaml') {
				const yaml = await import('js-yaml');
				output = yaml.dump(data, { lineWidth: -1 });
			} else {
				output = JSON.stringify(data, null, 2);
			}

			if (flags.output) {
				writeFileSync(flags.output, output, 'utf-8');
				if (!flags.json) {
					this.log(`Exported to ${flags.output}`);
				}
			} else {
				// Write to stdout directly (avoid adding newline via this.log)
				process.stdout.write(output);
				if (!output.endsWith('\n')) {
					process.stdout.write('\n');
				}
			}

			if (flags.json && flags.output) {
				this.outputJson({ ok: true, path: flags.output });
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}

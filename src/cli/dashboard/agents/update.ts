import { readFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class AgentsUpdate extends DashboardCommand {
	static override description = 'Update an agent configuration.';

	static override args = {
		id: Args.integer({ description: 'Agent config ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		'agent-type': Flags.string({ description: 'Agent type' }),
		model: Flags.string({ description: 'Model override' }),
		'max-iterations': Flags.integer({ description: 'Max iterations override' }),
		backend: Flags.string({ description: 'Agent backend override' }),
		prompt: Flags.string({ description: 'Custom prompt override (inline)' }),
		'prompt-file': Flags.string({
			description: 'Read prompt from file (use - for stdin)',
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(AgentsUpdate);

		try {
			let prompt: string | null | undefined = flags.prompt;
			if (flags['prompt-file']) {
				prompt =
					flags['prompt-file'] === '-'
						? readFileSync(0, 'utf-8')
						: readFileSync(flags['prompt-file'], 'utf-8');
			}

			await this.client.agentConfigs.update.mutate({
				id: args.id,
				agentType: flags['agent-type'],
				model: flags.model,
				maxIterations: flags['max-iterations'],
				agentBackend: flags.backend,
				prompt: prompt ?? null,
			});

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.log(`Updated agent config #${args.id}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}

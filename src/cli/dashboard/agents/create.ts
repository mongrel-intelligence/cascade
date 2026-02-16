import { readFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class AgentsCreate extends DashboardCommand {
	static override description = 'Create an agent configuration.';

	static override flags = {
		...DashboardCommand.baseFlags,
		'agent-type': Flags.string({
			description: 'Agent type (e.g. implementation, review)',
			required: true,
		}),
		'project-id': Flags.string({ description: 'Scope to specific project' }),
		model: Flags.string({ description: 'Model override' }),
		'max-iterations': Flags.integer({ description: 'Max iterations override' }),
		backend: Flags.string({ description: 'Agent backend override' }),
		prompt: Flags.string({ description: 'Custom prompt override (inline)' }),
		'prompt-file': Flags.string({
			description: 'Read prompt from file (use - for stdin)',
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(AgentsCreate);

		try {
			let prompt = flags.prompt ?? null;
			if (flags['prompt-file']) {
				prompt =
					flags['prompt-file'] === '-'
						? readFileSync(0, 'utf-8')
						: readFileSync(flags['prompt-file'], 'utf-8');
			}

			const result = await this.client.agentConfigs.create.mutate({
				agentType: flags['agent-type'],
				projectId: flags['project-id'],
				model: flags.model,
				maxIterations: flags['max-iterations'],
				agentBackend: flags.backend,
				prompt,
			});

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.log(`Created agent config for ${flags['agent-type']}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}

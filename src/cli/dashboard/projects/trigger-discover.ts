import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

/**
 * CLI command for discovering available triggers for an agent type.
 *
 * Usage:
 *   cascade projects trigger-discover --agent implementation
 *   cascade projects trigger-discover --agent review
 *   cascade projects trigger-discover --agent planning --json
 *
 * This command reads trigger definitions from the agent's YAML/DB definition
 * and displays them in a human-readable format or as JSON.
 */
export default class ProjectsTriggerDiscover extends DashboardCommand {
	static override description = 'Discover available triggers for an agent type.';

	static override aliases = ['projects:trigger-discover'];

	static override flags = {
		...DashboardCommand.baseFlags,
		agent: Flags.string({
			description: 'Agent type (e.g., implementation, review, splitting, planning)',
			required: true,
			char: 'a',
		}),
	};

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CLI command with conditional output formatting
	async run(): Promise<void> {
		const { flags } = await this.parse(ProjectsTriggerDiscover);

		try {
			const result = await this.client.agentDefinitions.get.query({
				agentType: flags.agent,
			});

			if (!result) {
				this.error(`Unknown agent type: ${flags.agent}`);
			}

			const triggers = result.definition.triggers ?? [];

			if (flags.json) {
				this.outputJson(triggers);
				return;
			}

			if (triggers.length === 0) {
				this.log(`\nNo triggers defined for "${flags.agent}" agent.\n`);
				return;
			}

			this.log(`\nAvailable triggers for "${flags.agent}" agent:\n`);

			for (const trigger of triggers) {
				this.log(`  ${trigger.event}`);
				this.log(`    Label: ${trigger.label}`);
				this.log(`    Default: ${trigger.defaultEnabled ? 'enabled' : 'disabled'}`);

				if (trigger.description) {
					this.log(`    Description: ${trigger.description}`);
				}

				if (trigger.providers && trigger.providers.length > 0) {
					this.log(`    Providers: ${trigger.providers.join(', ')}`);
				}

				if (trigger.parameters && trigger.parameters.length > 0) {
					this.log('    Parameters:');
					for (const param of trigger.parameters) {
						const required = param.required ? ' (required)' : '';
						const defaultVal =
							param.defaultValue !== undefined ? ` [default: ${param.defaultValue}]` : '';
						const options = param.options ? ` (options: ${param.options.join(', ')})` : '';
						this.log(`      - ${param.name}: ${param.type}${required}${defaultVal}${options}`);
						if (param.description) {
							this.log(`        ${param.description}`);
						}
					}
				}

				this.log('');
			}

			this.log('Usage example:');
			this.log(
				`  cascade projects trigger-set <project-id> --agent ${flags.agent} --event ${triggers[0]?.event ?? 'pm:example'} --enable`,
			);
			this.log('');
		} catch (err) {
			this.handleError(err);
		}
	}
}

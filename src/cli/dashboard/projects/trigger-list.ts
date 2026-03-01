import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

/**
 * CLI command for listing configured triggers for a project.
 *
 * Usage:
 *   cascade projects trigger-list <project-id>
 *   cascade projects trigger-list <project-id> --agent implementation
 *
 * Lists all trigger configurations from the agent_trigger_configs table.
 */
export default class ProjectsTriggerList extends DashboardCommand {
	static override description = 'List configured triggers for a project.';

	static override aliases = ['projects:trigger-list'];

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		agent: Flags.string({
			description: 'Filter by agent type (e.g., implementation, review)',
			char: 'a',
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsTriggerList);

		try {
			const configs = flags.agent
				? await this.client.agentTriggerConfigs.listByProjectAndAgent.query({
						projectId: args.id,
						agentType: flags.agent,
					})
				: await this.client.agentTriggerConfigs.listByProject.query({
						projectId: args.id,
					});

			if (flags.json) {
				this.outputJson(configs);
				return;
			}

			if (configs.length === 0) {
				this.log('No trigger configurations found.');
				if (!flags.agent) {
					this.log('Triggers are using default settings from agent definitions.');
				}
				return;
			}

			this.outputTable(
				configs.map((c) => ({
					agent: c.agentType,
					event: c.triggerEvent,
					enabled: c.enabled ? 'yes' : 'no',
					parameters: Object.keys(c.parameters).length > 0 ? JSON.stringify(c.parameters) : '-',
				})),
				[
					{ key: 'agent', header: 'Agent' },
					{ key: 'event', header: 'Event' },
					{ key: 'enabled', header: 'Enabled' },
					{ key: 'parameters', header: 'Parameters' },
				],
			);
		} catch (err) {
			this.handleError(err);
		}
	}
}

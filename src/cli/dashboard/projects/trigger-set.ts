import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

/**
 * CLI command for configuring agent triggers.
 *
 * Usage:
 *   cascade projects trigger-set <project-id> --agent implementation --event pm:status-changed --enable
 *   cascade projects trigger-set <project-id> --agent review --event scm:check-suite-success --disable
 *   cascade projects trigger-set <project-id> --agent review --event scm:check-suite-success --params '{"authorMode":"own"}'
 *
 * This is the unified command that replaces the older pm-trigger-set and review-trigger-set commands.
 * Uses the `agentTriggerConfigs.upsert` tRPC endpoint to store trigger configs in the new table.
 */
export default class ProjectsTriggerSet extends DashboardCommand {
	static override description =
		'Configure a trigger for a specific agent (unified command for all trigger types).';

	static override aliases = ['projects:trigger-set'];

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		agent: Flags.string({
			description: 'Agent type (e.g., implementation, review, splitting, planning)',
			required: true,
			char: 'a',
		}),
		event: Flags.string({
			description: 'Trigger event (e.g., pm:status-changed, scm:check-suite-success)',
			required: true,
			char: 'e',
		}),
		enable: Flags.boolean({
			description: 'Enable this trigger',
			exclusive: ['disable'],
		}),
		disable: Flags.boolean({
			description: 'Disable this trigger',
			exclusive: ['enable'],
		}),
		params: Flags.string({
			description: 'Trigger parameters as JSON (e.g., \'{"authorMode":"own"}\')',
			char: 'p',
		}),
		strict: Flags.boolean({
			description: 'Error on unknown events instead of warning',
			default: false,
		}),
	};

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CLI command with multiple validation paths
	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsTriggerSet);

		const agent = flags.agent;
		const event = flags.event;
		const enable = flags.enable;
		const disable = flags.disable;
		const paramsJson = flags.params;
		const strict = flags.strict;

		// Validate at least one option is provided
		if (enable === undefined && disable === undefined && paramsJson === undefined) {
			this.error('At least one of --enable, --disable, or --params must be provided.');
		}

		// Validate event format early (before API call)
		const eventPattern = /^(pm|scm|email|sms|internal):[a-z][a-z0-9-]*$/;
		if (!eventPattern.test(event)) {
			this.error(
				`Invalid event format: "${event}". Events must be in format {category}:{event-name} (e.g., pm:status-changed, scm:check-suite-success).`,
			);
		}

		// Parse parameters JSON if provided
		let parameters: Record<string, string | number | boolean> | undefined;
		if (paramsJson) {
			try {
				const parsed = JSON.parse(paramsJson);
				if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
					this.error('--params must be a JSON object');
				}
				// Validate all values are primitives (string, number, boolean)
				for (const [key, value] of Object.entries(parsed)) {
					const valueType = typeof value;
					if (valueType !== 'string' && valueType !== 'number' && valueType !== 'boolean') {
						this.error(`Invalid parameter value for "${key}": must be string, number, or boolean`);
					}
				}
				parameters = parsed as Record<string, string | number | boolean>;
			} catch (err) {
				if (err instanceof Error && err.message.startsWith('Invalid parameter value')) {
					throw err;
				}
				this.error(`Invalid JSON in --params: ${paramsJson}`);
			}
		}

		// Determine enabled state
		let enabled: boolean | undefined;
		if (enable) {
			enabled = true;
		} else if (disable) {
			enabled = false;
		}

		try {
			// Validate event against known triggers for this agent type
			const definition = await this.client.agentDefinitions.get.query({
				agentType: agent,
			});

			if (!definition) {
				this.error(`Unknown agent type: ${agent}`);
			}

			const validEvents = (definition.definition.triggers ?? []).map(
				(t: { event: string }) => t.event,
			);
			if (validEvents.length > 0 && !validEvents.includes(event)) {
				const message = `Unknown event "${event}" for agent "${agent}".`;
				const hint = `Valid events:\n  ${validEvents.join('\n  ')}\n\nRun "cascade projects trigger-discover --agent ${agent}" for details.`;
				if (strict) {
					this.error(`${message}\n\n${hint}`);
				}
				this.warn(message);
				this.log(hint);
			}

			const result = await this.client.agentTriggerConfigs.upsert.mutate({
				projectId: args.id,
				agentType: agent,
				triggerEvent: event,
				enabled,
				parameters,
			});

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			const lines: string[] = [`Trigger config updated for project: ${args.id}`];
			lines.push(`  Agent: ${agent}`);
			lines.push(`  Event: ${event}`);
			lines.push(`  Enabled: ${result.enabled}`);
			if (Object.keys(result.parameters).length > 0) {
				lines.push(`  Parameters: ${JSON.stringify(result.parameters)}`);
			}
			this.log(lines.join('\n'));
		} catch (err) {
			this.handleError(err);
		}
	}
}

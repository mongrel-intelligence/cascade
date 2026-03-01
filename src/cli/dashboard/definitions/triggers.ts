import { Args } from '@oclif/core';
import type { SupportedTrigger, TriggerParameter } from '../../../agents/definitions/schema.js';
import { TRIGGER_CATEGORY_LABELS } from '../../../api/routers/_shared/triggerTypes.js';
import { DashboardCommand } from '../_shared/base.js';

function groupTriggersByCategory(triggers: SupportedTrigger[]): Map<string, SupportedTrigger[]> {
	const grouped = new Map<string, SupportedTrigger[]>();
	for (const trigger of triggers) {
		const category = trigger.event.split(':')[0];
		const list = grouped.get(category) ?? [];
		list.push(trigger);
		grouped.set(category, list);
	}
	return grouped;
}

function formatParameter(param: TriggerParameter): string {
	const typeInfo =
		param.type === 'select' && param.options
			? `${param.type}: ${param.options.join('|')}`
			: param.type;
	const defaultInfo = param.defaultValue !== undefined ? ` = ${param.defaultValue}` : '';
	return `        ${param.name} (${typeInfo})${defaultInfo}`;
}

function formatTrigger(trigger: SupportedTrigger): string[] {
	const lines: string[] = [];
	const enabledMark = trigger.defaultEnabled ? '\u2713' : '\u2717';
	lines.push(`  ${enabledMark} ${trigger.event} (${trigger.label})`);

	if (trigger.providers && trigger.providers.length > 0) {
		lines.push(`    - providers: ${trigger.providers.join(', ')}`);
	}

	lines.push(`    - defaultEnabled: ${trigger.defaultEnabled}`);

	if (trigger.contextPipeline && trigger.contextPipeline.length > 0) {
		lines.push(`    - contextPipeline: ${trigger.contextPipeline.join(', ')}`);
	}

	if (trigger.parameters.length > 0) {
		lines.push('    - parameters:');
		for (const param of trigger.parameters) {
			lines.push(formatParameter(param));
		}
	}

	lines.push('');
	return lines;
}

export default class DefinitionsTriggers extends DashboardCommand {
	static override description = 'Show triggers defined in an agent definition.';

	static override args = {
		agentType: Args.string({ description: 'Agent type', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(DefinitionsTriggers);

		try {
			const result = await this.client.agentDefinitions.get.query({
				agentType: args.agentType,
			});

			const triggers = result.definition.triggers as SupportedTrigger[];

			if (flags.json) {
				this.outputJson({ agentType: args.agentType, triggers });
				return;
			}

			this.log(`Triggers for: ${args.agentType}`);
			this.log('');

			if (triggers.length === 0) {
				this.log('No triggers defined.');
				return;
			}

			const grouped = groupTriggersByCategory(triggers);

			for (const [category, categoryTriggers] of grouped) {
				this.log(TRIGGER_CATEGORY_LABELS[category] ?? `${category.toUpperCase()} Triggers`);

				for (const trigger of categoryTriggers) {
					const lines = formatTrigger(trigger);
					for (const line of lines) {
						this.log(line);
					}
				}
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}

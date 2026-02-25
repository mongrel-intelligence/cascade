import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

/**
 * CLI command for configuring PM trigger modes per agent type.
 *
 * Usage:
 *   cascade projects pm-trigger-set <project-id> [--card-moved-to-splitting] [--issue-transitioned-splitting] ...
 *
 * At least one flag must be provided. Pass `--no-<flag>` to disable a mode.
 * Uses the `projects.integrations.updateTriggers` tRPC endpoint, updating the
 * PM integration triggers config for the project.
 *
 * Trello flags update the top-level boolean keys (cardMovedToSplitting, etc.).
 * JIRA flags update the nested `issueTransitioned` object per agent type.
 */
export default class ProjectsPmTriggerSet extends DashboardCommand {
	static override description =
		'Configure PM trigger modes per agent type (card-moved for Trello, issue-transitioned for JIRA).';

	static override aliases = ['projects:pm-trigger-set'];

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		// Trello card-moved triggers
		'card-moved-to-splitting': Flags.boolean({
			description: 'Enable splitting agent when a card is moved to the Splitting list (Trello).',
			allowNo: true,
			default: undefined,
		}),
		'card-moved-to-planning': Flags.boolean({
			description: 'Enable planning agent when a card is moved to the Planning list (Trello).',
			allowNo: true,
			default: undefined,
		}),
		'card-moved-to-todo': Flags.boolean({
			description: 'Enable implementation agent when a card is moved to the Todo list (Trello).',
			allowNo: true,
			default: undefined,
		}),
		// JIRA issue-transitioned triggers (per-agent)
		'issue-transitioned-splitting': Flags.boolean({
			description:
				'Enable splitting agent when a JIRA issue transitions to the configured Splitting status.',
			allowNo: true,
			default: undefined,
		}),
		'issue-transitioned-planning': Flags.boolean({
			description:
				'Enable planning agent when a JIRA issue transitions to the configured Planning status.',
			allowNo: true,
			default: undefined,
		}),
		'issue-transitioned-implementation': Flags.boolean({
			description:
				'Enable implementation agent when a JIRA issue transitions to the configured Todo status.',
			allowNo: true,
			default: undefined,
		}),
	};

	/** Build the triggers patch object from parsed flag values. */
	private buildTriggers(parsedFlags: {
		cardMovedToSplitting: boolean | undefined;
		cardMovedToPlanning: boolean | undefined;
		cardMovedToTodo: boolean | undefined;
		issueTransitionedSplitting: boolean | undefined;
		issueTransitionedPlanning: boolean | undefined;
		issueTransitionedImplementation: boolean | undefined;
	}): Record<string, boolean | Record<string, boolean>> {
		const {
			cardMovedToSplitting,
			cardMovedToPlanning,
			cardMovedToTodo,
			issueTransitionedSplitting,
			issueTransitionedPlanning,
			issueTransitionedImplementation,
		} = parsedFlags;

		const triggers: Record<string, boolean | Record<string, boolean>> = {};

		if (cardMovedToSplitting !== undefined) triggers.cardMovedToSplitting = cardMovedToSplitting;
		if (cardMovedToPlanning !== undefined) triggers.cardMovedToPlanning = cardMovedToPlanning;
		if (cardMovedToTodo !== undefined) triggers.cardMovedToTodo = cardMovedToTodo;

		const issueTransitioned: Record<string, boolean> = {};
		if (issueTransitionedSplitting !== undefined)
			issueTransitioned.splitting = issueTransitionedSplitting;
		if (issueTransitionedPlanning !== undefined)
			issueTransitioned.planning = issueTransitionedPlanning;
		if (issueTransitionedImplementation !== undefined)
			issueTransitioned.implementation = issueTransitionedImplementation;

		if (Object.keys(issueTransitioned).length > 0) {
			triggers.issueTransitioned = issueTransitioned;
		}

		return triggers;
	}

	/** Format a human-readable summary of changed triggers. */
	private formatOutput(
		projectId: string,
		parsedFlags: {
			cardMovedToSplitting: boolean | undefined;
			cardMovedToPlanning: boolean | undefined;
			cardMovedToTodo: boolean | undefined;
			issueTransitionedSplitting: boolean | undefined;
			issueTransitionedPlanning: boolean | undefined;
			issueTransitionedImplementation: boolean | undefined;
		},
	): string {
		const {
			cardMovedToSplitting,
			cardMovedToPlanning,
			cardMovedToTodo,
			issueTransitionedSplitting,
			issueTransitionedPlanning,
			issueTransitionedImplementation,
		} = parsedFlags;

		const lines: string[] = [`PM trigger modes updated for project: ${projectId}`];
		if (cardMovedToSplitting !== undefined)
			lines.push(`  cardMovedToSplitting: ${cardMovedToSplitting}`);
		if (cardMovedToPlanning !== undefined)
			lines.push(`  cardMovedToPlanning: ${cardMovedToPlanning}`);
		if (cardMovedToTodo !== undefined) lines.push(`  cardMovedToTodo: ${cardMovedToTodo}`);
		if (issueTransitionedSplitting !== undefined)
			lines.push(`  issueTransitioned.splitting: ${issueTransitionedSplitting}`);
		if (issueTransitionedPlanning !== undefined)
			lines.push(`  issueTransitioned.planning: ${issueTransitionedPlanning}`);
		if (issueTransitionedImplementation !== undefined)
			lines.push(`  issueTransitioned.implementation: ${issueTransitionedImplementation}`);
		return lines.join('\n');
	}

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsPmTriggerSet);

		const cardMovedToSplitting = flags['card-moved-to-splitting'];
		const cardMovedToPlanning = flags['card-moved-to-planning'];
		const cardMovedToTodo = flags['card-moved-to-todo'];
		const issueTransitionedSplitting = flags['issue-transitioned-splitting'];
		const issueTransitionedPlanning = flags['issue-transitioned-planning'];
		const issueTransitionedImplementation = flags['issue-transitioned-implementation'];

		const hasAnyFlag =
			cardMovedToSplitting !== undefined ||
			cardMovedToPlanning !== undefined ||
			cardMovedToTodo !== undefined ||
			issueTransitionedSplitting !== undefined ||
			issueTransitionedPlanning !== undefined ||
			issueTransitionedImplementation !== undefined;

		if (!hasAnyFlag) {
			this.error(
				'At least one flag must be provided: ' +
					'--card-moved-to-splitting, --card-moved-to-planning, --card-moved-to-todo, ' +
					'--issue-transitioned-splitting, --issue-transitioned-planning, --issue-transitioned-implementation ' +
					'(use --no-<flag> to disable).',
			);
		}

		const parsedFlags = {
			cardMovedToSplitting,
			cardMovedToPlanning,
			cardMovedToTodo,
			issueTransitionedSplitting,
			issueTransitionedPlanning,
			issueTransitionedImplementation,
		};

		const triggers = this.buildTriggers(parsedFlags);

		try {
			await this.client.projects.integrations.updateTriggers.mutate({
				projectId: args.id,
				category: 'pm',
				triggers,
			});

			if (flags.json) {
				this.outputJson({ ok: true, triggers });
				return;
			}

			this.log(this.formatOutput(args.id, parsedFlags));
		} catch (err) {
			this.handleError(err);
		}
	}
}

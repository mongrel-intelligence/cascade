import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

/**
 * CLI command for configuring the review agent's trigger modes.
 *
 * Usage:
 *   cascade projects review-trigger-set <project-id> [--own-prs-only] [--external-prs] [--on-review-requested]
 *
 * At least one flag must be provided. Pass `--no-<flag>` to disable a mode.
 * Uses the `projects.integrations.updateTriggers` tRPC endpoint, updating the
 * `reviewTrigger` nested object in the project's SCM integration triggers.
 */
export default class ProjectsReviewTriggerSet extends DashboardCommand {
	static override description =
		'Configure review trigger modes for a project (which PRs the review agent should review).';

	static override aliases = ['projects:review-trigger-set'];

	static override args = {
		id: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		'own-prs-only': Flags.boolean({
			description:
				'Enable review agent for PRs authored by the implementer persona (after CI passes).',
			allowNo: true,
			default: undefined,
		}),
		'external-prs': Flags.boolean({
			description:
				'Enable review agent for PRs authored by anyone outside the CASCADE personas (after CI passes).',
			allowNo: true,
			default: undefined,
		}),
		'on-review-requested': Flags.boolean({
			description:
				'Enable review agent when a CASCADE persona is explicitly requested as reviewer.',
			allowNo: true,
			default: undefined,
		}),
		'pr-opened': Flags.boolean({
			description:
				'Enable respond-to-review on newly opened PRs (filtered by own-prs-only / external-prs).',
			allowNo: true,
			default: undefined,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(ProjectsReviewTriggerSet);

		const ownPrsOnly = flags['own-prs-only'];
		const externalPrs = flags['external-prs'];
		const onReviewRequested = flags['on-review-requested'];
		const prOpened = flags['pr-opened'];

		if (
			ownPrsOnly === undefined &&
			externalPrs === undefined &&
			onReviewRequested === undefined &&
			prOpened === undefined
		) {
			this.error(
				'At least one flag must be provided: --own-prs-only, --external-prs, --on-review-requested, --pr-opened (use --no-<flag> to disable).',
			);
		}

		// Build the nested reviewTrigger object with only the provided flags
		const reviewTrigger: Record<string, boolean> = {};
		if (ownPrsOnly !== undefined) reviewTrigger.ownPrsOnly = ownPrsOnly;
		if (externalPrs !== undefined) reviewTrigger.externalPrs = externalPrs;
		if (onReviewRequested !== undefined) reviewTrigger.onReviewRequested = onReviewRequested;

		// Build the top-level triggers payload
		const triggers: Record<string, boolean | Record<string, boolean>> = {};
		if (Object.keys(reviewTrigger).length > 0) triggers.reviewTrigger = reviewTrigger;
		if (prOpened !== undefined) triggers.prOpened = prOpened;

		try {
			await this.client.projects.integrations.updateTriggers.mutate({
				projectId: args.id,
				category: 'scm',
				triggers,
			});

			if (flags.json) {
				this.outputJson({ ok: true, ...triggers });
				return;
			}

			const lines: string[] = [`Review trigger modes updated for project: ${args.id}`];
			if (ownPrsOnly !== undefined) lines.push(`  ownPrsOnly: ${ownPrsOnly}`);
			if (externalPrs !== undefined) lines.push(`  externalPrs: ${externalPrs}`);
			if (onReviewRequested !== undefined) lines.push(`  onReviewRequested: ${onReviewRequested}`);
			if (prOpened !== undefined) lines.push(`  prOpened: ${prOpened}`);
			this.log(lines.join('\n'));
		} catch (err) {
			this.handleError(err);
		}
	}
}

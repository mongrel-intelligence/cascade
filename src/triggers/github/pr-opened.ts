import {
	resolveGitHubTriggerEnabled,
	resolveReviewTriggerConfig,
} from '../../config/triggerConfig.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { isGitHubPullRequestPayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

/**
 * Trigger that fires the review agent when a new PR is opened.
 * Resolves work item from DB (with PR body fallback); fires even without a linked work item.
 */
export class PROpenedTrigger implements TriggerHandler {
	name = 'pr-opened';
	description = 'Triggers review agent when a new PR is opened';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubPullRequestPayload(ctx.payload)) return false;

		// Check trigger config — opt-in trigger, default disabled
		if (!resolveGitHubTriggerEnabled(ctx.project.github?.triggers, 'prOpened')) {
			return false;
		}

		// Respect reviewTrigger config — at least one author mode must be active
		const reviewConfig = resolveReviewTriggerConfig(ctx.project.github?.triggers);
		if (!reviewConfig.ownPrsOnly && !reviewConfig.externalPrs) {
			return false;
		}

		// Only trigger on newly opened PRs
		if (ctx.payload.action !== 'opened') return false;

		// Skip draft PRs - wait until they're ready for review
		if (ctx.payload.pull_request.draft) return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as {
			pull_request: {
				number: number;
				title: string;
				body: string | null;
				html_url: string;
				head: { ref: string; sha: string };
				user: { login: string };
			};
			repository: { full_name: string };
		};

		const prNumber = payload.pull_request.number;
		const prAuthor = payload.pull_request.user.login;

		// Gate on PR author based on configured review trigger modes
		if (!ctx.personaIdentities) return null;
		const implLogin = ctx.personaIdentities.implementer;
		const isImplementerPR = prAuthor === implLogin || prAuthor === `${implLogin}[bot]`;

		const reviewConfig = resolveReviewTriggerConfig(ctx.project.github?.triggers);
		const shouldTrigger =
			(reviewConfig.ownPrsOnly && isImplementerPR) ||
			(reviewConfig.externalPrs && !isImplementerPR);

		if (!shouldTrigger) {
			logger.info('PR author does not match any enabled review trigger mode, skipping', {
				prNumber,
				prAuthor,
				isImplementerPR,
				ownPrsOnly: reviewConfig.ownPrsOnly,
				externalPrs: reviewConfig.externalPrs,
			});
			return null;
		}

		const prBody = payload.pull_request.body || '';

		// Resolve work item from DB (with PR body fallback)
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber, prBody, ctx.project);

		logger.info('New PR opened, triggering review agent', {
			prNumber,
			prTitle: payload.pull_request.title,
			workItemId,
		});

		return {
			agentType: 'review',
			agentInput: {
				prNumber,
				prBranch: payload.pull_request.head.ref,
				repoFullName: payload.repository.full_name,
				headSha: payload.pull_request.head.sha,
				triggerType: 'pr-opened',
				cardId: workItemId,
			},
			prNumber,
			workItemId,
		};
	}
}

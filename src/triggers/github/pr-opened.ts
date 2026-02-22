import { resolveGitHubTriggerEnabled } from '../../config/triggerConfig.js';
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

		// Only trigger on newly opened PRs
		if (ctx.payload.action !== 'opened') return false;

		// Skip draft PRs - wait until they're ready for review
		if (ctx.payload.pull_request.draft) return false;

		return true;
	}

	resolveAgentType(): string {
		return 'respond-to-review';
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as {
			pull_request: {
				number: number;
				title: string;
				body: string | null;
				html_url: string;
				head: { ref: string };
			};
			repository: { full_name: string };
		};

		const prNumber = payload.pull_request.number;
		const prBody = payload.pull_request.body || '';

		// Resolve work item from DB (with PR body fallback)
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber, prBody, ctx.project);

		logger.info('New PR opened, triggering review agent', {
			prNumber,
			prTitle: payload.pull_request.title,
			workItemId,
		});

		return {
			agentType: 'respond-to-review',
			agentInput: {
				prNumber,
				prBranch: payload.pull_request.head.ref,
				repoFullName: payload.repository.full_name,
				// For opened PRs, use PR URL and title/body as the "trigger"
				triggerCommentId: 0, // No comment, use 0 as sentinel
				triggerCommentBody: `New PR: ${payload.pull_request.title}\n\n${prBody}`,
				triggerCommentPath: '', // No specific file
				triggerCommentUrl: payload.pull_request.html_url,
			},
			prNumber,
			workItemId,
		};
	}
}

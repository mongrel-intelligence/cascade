import { githubClient } from '../../github/client.js';
import { getPMProvider } from '../../pm/context.js';
import { resolveProjectPMConfig } from '../../pm/lifecycle.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { isBacklogEmpty } from '../shared/backlog-check.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { type GitHubPullRequestPayload, isGitHubPullRequestPayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

export class PRMergedTrigger implements TriggerHandler {
	name = 'pr-merged';
	description = 'Moves work item to MERGED status when PR is merged';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubPullRequestPayload(ctx.payload)) return false;

		return ctx.payload.action === 'closed';
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check trigger config via new DB-driven system
		if (!(await checkTriggerEnabled(ctx.project.id, 'review', 'scm:pr-merged', this.name))) {
			return null;
		}

		const payload = ctx.payload as GitHubPullRequestPayload;
		const { owner, repo } = parseRepoFullName(payload.repository.full_name);
		const prNumber = payload.pull_request.number;

		// Fetch full PR details to check merged status
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		if (!prDetails.merged) {
			logger.info('PR closed but not merged, skipping', { prNumber });
			return null;
		}

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber);
		if (!workItemId) {
			logger.info('No work item linked to PR, skipping pr-merged', { prNumber });
			return null;
		}

		const pmConfig = resolveProjectPMConfig(ctx.project);
		const mergedStatus = pmConfig.statuses.merged;

		if (!mergedStatus) {
			logger.warn('No merged status configured for project', {
				projectId: ctx.project.id,
			});
			return null;
		}

		const provider = getPMProvider();

		// Idempotency: skip move/comment if work item is already in MERGED status
		// (handles concurrent webhooks or pre-moved cards from other triggers like pr-ready-to-merge)
		const workItem = await provider.getWorkItem(workItemId);
		const alreadyMerged = workItem.status === mergedStatus;

		if (alreadyMerged) {
			logger.info('Work item already in MERGED status, skipping duplicate move', {
				workItemId,
				prNumber,
			});
		} else {
			await provider.moveWorkItem(workItemId, mergedStatus);
			await provider.addComment(
				workItemId,
				`PR #${prNumber} has been merged to ${prDetails.baseRef}`,
			);
			logger.info('Moved work item to merged status', { workItemId, prNumber });
		}

		// Chain to backlog-manager if enabled (regardless of whether card was already merged)
		if (await checkTriggerEnabled(ctx.project.id, 'backlog-manager', 'scm:pr-merged', this.name)) {
			// Skip if the backlog is already empty — no point running the agent
			const backlogEmpty = await isBacklogEmpty(ctx.project, provider);
			if (backlogEmpty) {
				logger.info('Skipping backlog-manager: backlog is empty after PR merge', {
					workItemId,
					prNumber,
				});
			} else {
				logger.info('Chaining to backlog-manager after PR merge', { workItemId, prNumber });
				return {
					agentType: 'backlog-manager',
					// Include workItemId so PM operations (progress, lifecycle) have the work item ID.
					// The backlog-manager is a PM-focused agent — it needs the work item ID for ack posting
					// and PM lifecycle, not GitHub PR details.
					agentInput: { triggerEvent: 'scm:pr-merged', workItemId: workItemId },
					workItemId,
					prNumber,
				};
			}
		}

		return {
			agentType: null,
			agentInput: {},
			workItemId,
			prNumber,
		};
	}
}

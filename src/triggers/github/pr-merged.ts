import { resolveGitHubTriggerEnabled } from '../../config/triggerConfig.js';
import { githubClient } from '../../github/client.js';
import { getPMProvider } from '../../pm/context.js';
import { resolveProjectPMConfig } from '../../pm/lifecycle.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { type GitHubPullRequestPayload, isGitHubPullRequestPayload } from './types.js';
import { requireWorkItemId } from './utils.js';

export class PRMergedTrigger implements TriggerHandler {
	name = 'pr-merged';
	description = 'Moves work item to MERGED status when PR is merged';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubPullRequestPayload(ctx.payload)) return false;

		// Check trigger config — default enabled for backward compatibility
		if (!resolveGitHubTriggerEnabled(ctx.project.github?.triggers, 'prMerged')) {
			return false;
		}

		return ctx.payload.action === 'closed';
	}

	resolveAgentType(): string | null {
		return null; // No agent — performs card move directly
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as GitHubPullRequestPayload;
		const { owner, repo } = parseRepoFullName(payload.repository.full_name);
		const prNumber = payload.pull_request.number;

		// Fetch full PR details to check merged status
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		if (!prDetails.merged) {
			logger.info('PR closed but not merged, skipping', { prNumber });
			return null;
		}

		// Extract work item ID from PR body (works for both Trello and JIRA)
		const prBody = payload.pull_request.body || '';
		const workItemId = requireWorkItemId(prBody, ctx.project, {
			prNumber,
			triggerName: 'pr-merged',
		});
		if (!workItemId) return null;

		const pmConfig = resolveProjectPMConfig(ctx.project);
		const mergedStatus = pmConfig.statuses.merged;

		if (!mergedStatus) {
			logger.warn('No merged status configured for project', {
				projectId: ctx.project.id,
			});
			return null;
		}

		const provider = getPMProvider();

		// Idempotency: skip if work item is already in the MERGED status
		// (handles concurrent webhooks from multiple PR close events)
		const workItem = await provider.getWorkItem(workItemId);
		if (workItem.status === mergedStatus) {
			logger.info('Work item already in MERGED status, skipping duplicate move', {
				workItemId,
				prNumber,
			});
			return {
				agentType: null,
				agentInput: {},
				workItemId,
				prNumber,
			};
		}

		// Move work item to MERGED status
		await provider.moveWorkItem(workItemId, mergedStatus);
		await provider.addComment(
			workItemId,
			`PR #${prNumber} has been merged to ${prDetails.baseRef}`,
		);

		logger.info('Moved work item to merged status', { workItemId, prNumber });

		return {
			agentType: null,
			agentInput: {},
			workItemId,
			prNumber,
		};
	}
}

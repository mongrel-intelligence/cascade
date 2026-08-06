/**
 * GitLab MR Merged trigger.
 *
 * Moves work item to MERGED status when a MR is merged, then optionally
 * chains to the backlog-manager agent. Mirrors the GitHub pr-merged trigger.
 */

import { getPMProvider } from '../../pm/context.js';
import { resolveProjectPMConfig } from '../../pm/lifecycle.js';
import { invalidateSnapshot } from '../../router/snapshot-manager.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { isPipelineAtCapacity } from '../shared/backlog-check.js';
import { isLifecycleTriggerEnabled } from '../shared/lifecycle-check.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { type GitLabMergeRequestPayload, isGitLabMergeRequestPayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

export class MRMergedTrigger implements TriggerHandler {
	name = 'gitlab:mr-merged';
	description = 'Moves work item to MERGED status when a GitLab MR is merged';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'gitlab') return false;
		if (!isGitLabMergeRequestPayload(ctx.payload)) return false;

		// GitLab fires a merge_request hook with action 'merge' when MR is merged
		return ctx.payload.object_attributes.action === 'merge';
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check lifecycle trigger config
		if (!(await isLifecycleTriggerEnabled(ctx.project.id, 'prMerged', this.name))) {
			return null;
		}

		const payload = ctx.payload as GitLabMergeRequestPayload;
		const mrIid = payload.object_attributes.iid;

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, mrIid);
		if (!workItemId) {
			logger.info('No work item linked to MR, skipping mr-merged', { mrIid });
			return null;
		}

		// Invalidate any stale snapshot for this work item
		invalidateSnapshot(ctx.project.id, workItemId);

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
		const workItem = await provider.getWorkItem(workItemId);
		const alreadyMerged = workItem.status === mergedStatus;

		if (alreadyMerged) {
			logger.info('Work item already in MERGED status, skipping duplicate move', {
				workItemId,
				mrIid,
			});
		} else {
			await provider.moveWorkItem(workItemId, mergedStatus);
			await provider.addComment(
				workItemId,
				`MR !${mrIid} has been merged to ${payload.object_attributes.target_branch}`,
			);
			logger.info('Moved work item to merged status', { workItemId, mrIid });
		}

		// Chain to backlog-manager if enabled
		if (await checkTriggerEnabled(ctx.project.id, 'backlog-manager', 'scm:pr-merged', this.name)) {
			const capacityResult = await isPipelineAtCapacity(ctx.project, provider);
			if (capacityResult.atCapacity) {
				logger.info('Skipping backlog-manager: pipeline at capacity after MR merge', {
					workItemId,
					mrIid,
					reason: capacityResult.reason,
					inFlightCount: capacityResult.inFlightCount,
					limit: capacityResult.limit,
				});
			} else {
				logger.info('Chaining to backlog-manager after MR merge', { workItemId, mrIid });
				return {
					agentType: 'backlog-manager',
					agentInput: { triggerEvent: 'scm:pr-merged', workItemId: workItemId },
					workItemId,
					prNumber: mrIid,
				};
			}
		}

		return {
			agentType: null,
			agentInput: {},
			workItemId,
			prNumber: mrIid,
		};
	}
}

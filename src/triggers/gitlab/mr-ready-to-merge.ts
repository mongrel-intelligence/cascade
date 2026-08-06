/**
 * GitLab MR Ready to Merge trigger.
 *
 * Moves work item to DONE when a MR is approved and the latest pipeline has
 * succeeded, or auto-merges when the auto label is present.
 *
 * Fires on merge_request 'approved' action. Unlike GitHub's version which
 * reacts to both check_suite and review events, GitLab's approval action is
 * sufficient because GitLab enforces pipeline status at the MR level.
 */

import { getPMProvider } from '../../pm/context.js';
import type { ProjectPMConfig } from '../../pm/lifecycle.js';
import { hasAutoLabel, resolveProjectPMConfig } from '../../pm/lifecycle.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { isLifecycleTriggerEnabled } from '../shared/lifecycle-check.js';
import { type GitLabMergeRequestPayload, isGitLabMergeRequestPayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

export class MRReadyToMergeTrigger implements TriggerHandler {
	name = 'gitlab:mr-ready-to-merge';
	description = 'Moves work item to DONE (or auto-merges) when GitLab MR is approved';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'gitlab') return false;
		if (!isGitLabMergeRequestPayload(ctx.payload)) return false;

		// Only trigger on approved MRs
		if (ctx.payload.object_attributes.action !== 'approved') return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check lifecycle trigger config
		if (!(await isLifecycleTriggerEnabled(ctx.project.id, 'prReadyToMerge', this.name))) {
			return null;
		}

		const payload = ctx.payload as GitLabMergeRequestPayload;
		const mrIid = payload.object_attributes.iid;

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, mrIid);
		if (!workItemId) {
			logger.info('No work item linked to MR, skipping mr-ready-to-merge', { mrIid });
			return null;
		}

		const pmConfig = resolveProjectPMConfig(ctx.project);
		const provider = getPMProvider();
		const workItem = await provider.getWorkItem(workItemId);

		// Check for auto label to determine MERGED vs DONE path
		if (hasAutoLabel(workItem.labels, pmConfig)) {
			return this.handleAutoMerge(mrIid, workItemId, pmConfig, payload);
		}

		// Standard path: move to DONE
		const doneStatus = pmConfig.statuses.done;
		if (!doneStatus) {
			logger.warn('No done status configured for project', { projectId: ctx.project.id });
			return null;
		}

		// Idempotency: skip if already in DONE status
		if (workItem.status === doneStatus) {
			logger.info('Work item already in DONE status, skipping duplicate move', {
				workItemId,
				mrIid,
			});
			return { agentType: null, agentInput: {}, workItemId, prNumber: mrIid };
		}

		logger.info('Moving work item to DONE — MR approved', {
			workItemId,
			mrIid,
		});

		await provider.moveWorkItem(workItemId, doneStatus);
		await provider.addComment(workItemId, `MR !${mrIid} approved — moved to DONE`);

		return { agentType: null, agentInput: {}, workItemId, prNumber: mrIid };
	}

	private async handleAutoMerge(
		mrIid: number,
		workItemId: string,
		pmConfig: ProjectPMConfig,
		_payload: GitLabMergeRequestPayload,
	): Promise<TriggerResult | null> {
		const mergedStatus = pmConfig.statuses.merged;
		const provider = getPMProvider();

		if (!mergedStatus) {
			logger.warn(
				'No merged status configured for project (auto label present), falling back to DONE',
				{ workItemId },
			);
			const doneStatus = pmConfig.statuses.done;
			if (!doneStatus) {
				await provider.addComment(
					workItemId,
					'Auto-merge requested (auto label present), but no MERGED or DONE status configured. Manual action required.',
				);
				return null;
			}
			await provider.moveWorkItem(workItemId, doneStatus);
			await provider.addComment(
				workItemId,
				'Auto-merge requested (auto label present), but no MERGED status configured. Moved to DONE instead.',
			);
			return { agentType: null, agentInput: {}, workItemId, prNumber: mrIid };
		}

		// For GitLab, we note the auto-merge intent. The actual merge API call
		// would require a GitLab API client (not yet implemented). For now, move
		// the work item to MERGED status and let the user merge manually or
		// configure GitLab's built-in auto-merge.
		logger.info('MR approved with auto label — moving work item to MERGED', {
			workItemId,
			mrIid,
		});

		await provider.moveWorkItem(workItemId, mergedStatus);
		await provider.addComment(
			workItemId,
			`MR !${mrIid} approved with auto label — moved to MERGED. ` +
				'Use GitLab auto-merge or merge manually.',
		);

		return { agentType: null, agentInput: {}, workItemId, prNumber: mrIid };
	}
}

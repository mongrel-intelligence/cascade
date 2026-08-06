/**
 * GitLab MR Opened trigger.
 *
 * Triggers the review agent when a new Merge Request is opened in GitLab.
 * Skips WIP/draft MRs. Resolves work item from DB; fires even without a
 * linked work item.
 */

import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';
import { type GitLabMergeRequestPayload, isGitLabMergeRequestPayload } from './types.js';
import { evaluateAuthorMode, resolveWorkItemId } from './utils.js';

export class MROpenedTrigger implements TriggerHandler {
	name = 'gitlab:mr-opened';
	description = 'Triggers review agent when a new MR is opened in GitLab';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'gitlab') return false;
		if (!isGitLabMergeRequestPayload(ctx.payload)) return false;

		// Only trigger on newly opened MRs
		if (ctx.payload.object_attributes.action !== 'open') return false;

		// Skip WIP/draft MRs — wait until they're ready for review
		if (ctx.payload.object_attributes.work_in_progress) return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check trigger config + get parameters in a single DB call
		const triggerConfig = await checkTriggerEnabledWithParams(
			ctx.project.id,
			'review',
			'scm:pr-opened',
			this.name,
		);
		if (!triggerConfig.enabled) {
			return null;
		}

		const payload = ctx.payload as GitLabMergeRequestPayload;
		const mrIid = payload.object_attributes.iid;
		const mrAuthor = payload.user.username;

		// Gate on MR author based on configured authorMode parameter
		const authorResult = evaluateAuthorMode(
			mrAuthor,
			ctx.personaIdentities,
			triggerConfig.parameters,
			this.name,
		);
		if (!authorResult) {
			return null;
		}
		if (!authorResult.shouldTrigger) {
			logger.info('MR author does not match configured authorMode, skipping', {
				handler: this.name,
				mrIid,
				mrAuthor,
				isImplementerMR: authorResult.isImplementerMR,
				authorMode: authorResult.authorMode,
			});
			return null;
		}

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, mrIid);

		logger.info('New MR opened, triggering review agent', {
			mrIid,
			mrTitle: payload.object_attributes.title,
			workItemId,
		});

		return {
			agentType: 'review',
			agentInput: {
				prNumber: mrIid,
				prBranch: payload.object_attributes.source_branch,
				repoFullName: payload.project.path_with_namespace,
				headSha: payload.object_attributes.last_commit.id,
				triggerType: 'pr-opened',
				triggerEvent: 'scm:pr-opened',
				workItemId: workItemId,
			},
			prNumber: mrIid,
			prUrl: payload.object_attributes.url,
			prTitle: payload.object_attributes.title,
			workItemId,
		};
	}
}

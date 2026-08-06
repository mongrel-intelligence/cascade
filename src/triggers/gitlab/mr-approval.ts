/**
 * GitLab MR Approval trigger.
 *
 * Triggers respond-to-review when a MR is unapproved (equivalent to
 * GitHub's changes_requested review). Approved MRs are handled by
 * MRReadyToMergeTrigger instead.
 *
 * GitLab fires merge_request hooks with action 'approved' or 'unapproved'.
 */

import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { type GitLabMergeRequestPayload, isGitLabMergeRequestPayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

export class MRApprovalTrigger implements TriggerHandler {
	name = 'gitlab:mr-approval';
	description = 'Triggers respond-to-review when a GitLab MR is unapproved';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'gitlab') return false;
		if (!isGitLabMergeRequestPayload(ctx.payload)) return false;

		const action = ctx.payload.object_attributes.action;

		// Only respond to unapproved (changes requested) — approved is handled by ready-to-merge
		if (action !== 'unapproved') return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check trigger config via DB-driven system
		if (
			!(await checkTriggerEnabled(
				ctx.project.id,
				'respond-to-review',
				'scm:pr-review-submitted',
				this.name,
			))
		) {
			return null;
		}

		const payload = ctx.payload as GitLabMergeRequestPayload;
		const mrIid = payload.object_attributes.iid;
		const reviewAuthor = payload.user.username;

		// Only respond to reviews from the reviewer persona
		if (!ctx.personaIdentities) {
			logger.warn('No persona identities available, skipping MR approval trigger', { mrIid });
			return null;
		}

		if (reviewAuthor !== ctx.personaIdentities.reviewer) {
			logger.info('Skipping MR unapproval not from reviewer persona', {
				mrIid,
				reviewAuthor,
				expectedReviewer: ctx.personaIdentities.reviewer,
			});
			return null;
		}

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, mrIid);

		logger.info('MR unapproved by reviewer persona, triggering respond-to-review', {
			mrIid,
			reviewAuthor,
			workItemId,
		});

		return {
			agentType: 'respond-to-review',
			agentInput: {
				prNumber: mrIid,
				prBranch: payload.object_attributes.source_branch,
				repoFullName: payload.project.path_with_namespace,
				triggerEvent: 'scm:pr-review-submitted',
				triggerCommentBody: 'MR unapproved (changes requested)',
				triggerCommentPath: '',
				workItemId,
			},
			prNumber: mrIid,
			prUrl: payload.object_attributes.url,
			prTitle: payload.object_attributes.title,
			workItemId,
		};
	}
}

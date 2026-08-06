/**
 * GitLab MR Reviewer Added trigger.
 *
 * Triggers the review agent when a CASCADE persona is added as reviewer
 * on a merge request. This is the GitLab equivalent of GitHub's
 * ReviewRequestedTrigger.
 *
 * Fires on MR `update` action when `changes.reviewers` shows a new
 * reviewer that matches a CASCADE persona (implementer or reviewer).
 */

import { isCascadeBot } from '../../gitlab/personas.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { type GitLabMergeRequestPayload, isGitLabMergeRequestPayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

export class MRReviewerAddedTrigger implements TriggerHandler {
	name = 'gitlab:mr-reviewer-added';
	description = 'Triggers review agent when a CASCADE persona is added as reviewer on a GitLab MR';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'gitlab') return false;
		if (!isGitLabMergeRequestPayload(ctx.payload)) return false;

		// Only trigger on update action (reviewer changes come as updates)
		if (ctx.payload.object_attributes.action !== 'update') return false;

		// Must have reviewer changes
		const changes = ctx.payload.changes as Record<string, unknown> | undefined;
		const reviewerChanges = changes?.reviewers as
			| { previous?: unknown[]; current?: unknown[] }
			| undefined;
		if (!reviewerChanges?.current || !reviewerChanges?.previous) return false;

		// Only trigger when reviewers were added (current > previous)
		if (reviewerChanges.current.length <= reviewerChanges.previous.length) return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		if (!(await checkTriggerEnabled(ctx.project.id, 'review', 'scm:review-requested', this.name))) {
			return null;
		}

		const payload = ctx.payload as GitLabMergeRequestPayload;
		const mrIid = payload.object_attributes.iid;
		const headSha = payload.object_attributes.last_commit.id;

		if (!ctx.personaIdentities) {
			logger.warn('No persona identities available, skipping mr-reviewer-added trigger', {
				mrIid,
			});
			return null;
		}

		// Skip if the implementer persona is adding reviewers (loop prevention).
		// Only the implementer can cause a loop (e.g. implementation agent requesting
		// its own review). The reviewer persona acting as sender is fine — that's a
		// human using the reviewer account to assign review.
		const senderUsername = payload.user.username;
		if (senderUsername === ctx.personaIdentities.implementer) {
			logger.info('Skipping reviewer addition from implementer persona (loop prevention)', {
				mrIid,
				sender: senderUsername,
			});
			return null;
		}

		// Check if any newly added reviewer is a CASCADE persona
		const changes = payload.changes as Record<string, unknown>;
		const reviewerChanges = changes.reviewers as {
			previous: Array<{ username: string }>;
			current: Array<{ username: string }>;
		};
		const previousUsernames = new Set(reviewerChanges.previous.map((r) => r.username));
		const newReviewers = reviewerChanges.current.filter((r) => !previousUsernames.has(r.username));

		const cascadeReviewer = newReviewers.find((r) =>
			isCascadeBot(r.username, ctx.personaIdentities!),
		);
		if (!cascadeReviewer) {
			logger.debug('No CASCADE persona among newly added reviewers, skipping', {
				mrIid,
				newReviewers: newReviewers.map((r) => r.username),
			});
			return null;
		}

		const workItemId = await resolveWorkItemId(ctx.project.id, mrIid);

		logger.info('CASCADE persona added as reviewer, triggering review agent', {
			mrIid,
			reviewer: cascadeReviewer.username,
			workItemId,
			headSha,
		});

		return {
			agentType: 'review',
			agentInput: {
				prNumber: mrIid,
				prBranch: payload.object_attributes.source_branch,
				repoFullName: payload.project.path_with_namespace,
				headSha,
				triggerType: 'review-requested',
				triggerEvent: 'scm:review-requested',
				workItemId,
			},
			prNumber: mrIid,
			prUrl: payload.object_attributes.url,
			prTitle: payload.object_attributes.title,
			workItemId,
		};
	}
}

/**
 * GitLab MR Comment Mention trigger.
 *
 * Triggers respond-to-pr-comment when someone @mentions the implementer bot
 * in a Note on a Merge Request. Returns null (falls through) when there's
 * no @mention, allowing existing triggers to handle the event.
 */

import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { type GitLabNotePayload, isGitLabNotePayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

export class MRCommentMentionTrigger implements TriggerHandler {
	name = 'gitlab:mr-comment-mention';
	description = 'Triggers respond-to-pr-comment when someone @mentions the bot in a GitLab MR note';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'gitlab') return false;
		if (!isGitLabNotePayload(ctx.payload)) return false;

		// Only match notes on merge requests
		if (ctx.payload.object_attributes.noteable_type !== 'MergeRequest') return false;

		// Must have an associated merge request
		if (!ctx.payload.merge_request) return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check trigger config via DB-driven system
		if (
			!(await checkTriggerEnabled(
				ctx.project.id,
				'respond-to-pr-comment',
				'scm:pr-comment-mention',
				this.name,
			))
		) {
			return null;
		}

		// Require persona identities for @mention detection
		if (!ctx.personaIdentities) {
			logger.warn('No persona identities available, skipping @mention trigger');
			return null;
		}

		const payload = ctx.payload as GitLabNotePayload;
		const commentBody = payload.object_attributes.note;
		const commentAuthor = payload.user.username;
		const mr = payload.merge_request!;
		const mrIid = mr.iid;

		// The implementer persona is who humans @mention (it writes code and responds)
		const mentionTarget = ctx.personaIdentities.implementer;

		// Check for @mention of the implementer persona (case-insensitive)
		const mentionPattern = new RegExp(`@${mentionTarget}\\b`, 'i');
		if (!mentionPattern.test(commentBody)) {
			logger.debug('No @mention in note, skipping', { mrIid, mentionTarget });
			return null;
		}

		// Skip @mentions from the implementer persona (loop prevention — it's the one
		// that responds to comments). The reviewer persona commenting is fine — that's
		// a human using the reviewer account.
		if (commentAuthor === ctx.personaIdentities.implementer) {
			logger.info('Skipping @mention from implementer persona (loop prevention)', {
				mrIid,
				commentAuthor,
			});
			return null;
		}

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, mrIid);

		logger.info('MR note @mention detected, triggering respond-to-pr-comment agent', {
			mrIid,
			commentAuthor,
			mentionTarget,
			workItemId,
		});

		return {
			agentType: 'respond-to-pr-comment',
			agentInput: {
				prNumber: mrIid,
				prBranch: mr.source_branch,
				repoFullName: payload.project.path_with_namespace,
				triggerEvent: 'scm:pr-comment-mention',
				triggerCommentId: payload.object_attributes.id,
				triggerCommentBody: commentBody,
				triggerCommentPath: '',
				triggerCommentUrl: payload.object_attributes.url,
				commentAuthor,
				workItemId,
			},
			prNumber: mrIid,
			prUrl: mr.url,
			prTitle: mr.title,
			workItemId,
		};
	}
}

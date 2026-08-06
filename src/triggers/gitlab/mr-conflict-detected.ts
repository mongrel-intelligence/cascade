/**
 * GitLab MR Conflict Detected trigger.
 *
 * Triggers the resolve-conflicts agent when a MR update reveals merge conflicts.
 * GitLab provides `has_conflicts` in the MR payload, unlike GitHub which requires
 * an API call to check mergeability.
 */

import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { type GitLabMergeRequestPayload, isGitLabMergeRequestPayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

// Track conflict resolution attempts per MR to prevent infinite loops
const conflictAttempts = new Map<number, number>();
const MAX_ATTEMPTS = 2;

// Export for cleanup when conflicts are resolved
export function resetConflictAttempts(mrIid: number): void {
	conflictAttempts.delete(mrIid);
}

export class MRConflictDetectedTrigger implements TriggerHandler {
	name = 'gitlab:mr-conflict-detected';
	description = 'Triggers resolve-conflicts agent when a GitLab MR has merge conflicts';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'gitlab') return false;
		if (!isGitLabMergeRequestPayload(ctx.payload)) return false;

		const payload = ctx.payload;

		// Only trigger on update actions (when MR head is pushed/rebased)
		if (payload.object_attributes.action !== 'update') return false;

		// Only fire if MR has conflicts
		if (!payload.object_attributes.has_conflicts) return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check trigger config via DB-driven system
		if (
			!(await checkTriggerEnabled(
				ctx.project.id,
				'resolve-conflicts',
				'scm:pr-conflict-detected',
				this.name,
			))
		) {
			return null;
		}

		const payload = ctx.payload as GitLabMergeRequestPayload;
		const mrIid = payload.object_attributes.iid;
		const mrAuthor = payload.user.username;
		const repoFullName = payload.project.path_with_namespace;

		// Gate on MR author being the implementer persona
		if (!ctx.personaIdentities) {
			logger.info('No persona identities available, skipping', {
				handler: this.name,
				mrIid,
			});
			return null;
		}
		const implLogin = ctx.personaIdentities.implementer;
		if (mrAuthor !== implLogin && mrAuthor !== `${implLogin}[bot]`) {
			logger.info('MR not authored by implementer persona, skipping conflict detection trigger', {
				mrIid,
				mrAuthor,
			});
			return null;
		}

		// Only trigger for MRs targeting the project's base branch
		if (payload.object_attributes.target_branch !== ctx.project.baseBranch) {
			logger.info('MR targets non-base branch, skipping conflict detection trigger', {
				mrIid,
				targetBranch: payload.object_attributes.target_branch,
				projectBaseBranch: ctx.project.baseBranch,
			});
			return null;
		}

		// Check attempt limit to prevent infinite loops
		const attempts = conflictAttempts.get(mrIid) || 0;
		if (attempts >= MAX_ATTEMPTS) {
			logger.warn('Max conflict resolution attempts reached for MR', {
				mrIid,
				attempts,
			});
			return null;
		}

		// Increment attempt counter
		conflictAttempts.set(mrIid, attempts + 1);

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, mrIid);

		logger.info('MR has merge conflicts -- triggering resolve-conflicts agent', {
			mrIid,
			workItemId,
			attempt: attempts + 1,
		});

		return {
			agentType: 'resolve-conflicts',
			agentInput: {
				prNumber: mrIid,
				prBranch: payload.object_attributes.source_branch,
				repoFullName,
				headSha: payload.object_attributes.last_commit.id,
				triggerType: 'conflict-resolution',
				triggerEvent: 'scm:pr-conflict-detected',
				workItemId: workItemId,
			},
			prNumber: mrIid,
			prUrl: payload.object_attributes.url,
			prTitle: payload.object_attributes.title,
			workItemId,
		};
	}
}

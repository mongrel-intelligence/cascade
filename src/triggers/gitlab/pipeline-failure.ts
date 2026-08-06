/**
 * GitLab Pipeline Failure trigger.
 *
 * Triggers the respond-to-ci agent when a pipeline fails on a MR authored
 * by the implementer persona. Includes attempt limiting to prevent infinite
 * fix loops.
 */

import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { type GitLabPipelinePayload, isGitLabPipelinePayload } from './types.js';
import { resolveMergeRequestForPipeline, resolveWorkItemId } from './utils.js';

// Track fix attempts per MR to prevent infinite loops
const fixAttempts = new Map<number, number>();
const MAX_ATTEMPTS = 3;

// Export for cleanup
export function resetFixAttempts(mrIid: number): void {
	fixAttempts.delete(mrIid);
}

export class PipelineFailureTrigger implements TriggerHandler {
	name = 'gitlab:pipeline-failure';
	description =
		'Triggers respond-to-ci agent when pipeline fails on a GitLab MR by the implementer persona';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'gitlab') return false;
		if (!isGitLabPipelinePayload(ctx.payload)) return false;

		// Only trigger on failed pipelines
		if (ctx.payload.object_attributes.status !== 'failed') return false;

		// MR association is checked in handle() via API fallback
		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check trigger config via DB-driven system
		if (
			!(await checkTriggerEnabled(
				ctx.project.id,
				'respond-to-ci',
				'scm:check-suite-failure',
				this.name,
			))
		) {
			return null;
		}

		const payload = ctx.payload as GitLabPipelinePayload;

		// Resolve MR — from payload or by looking up open MR for the branch
		const mr = await resolveMergeRequestForPipeline(payload);
		if (!mr) {
			logger.debug('No MR associated with failed pipeline, skipping', {
				handler: this.name,
				ref: payload.object_attributes.ref,
			});
			return null;
		}
		const mrIid = mr.iid;
		const mrAuthor = payload.user.username;
		const headSha = payload.object_attributes.sha;

		// Gate on MR author being the implementer persona
		if (!ctx.personaIdentities) {
			logger.info('No persona identities available, skipping', { handler: this.name, mrIid });
			return null;
		}
		const implLogin = ctx.personaIdentities.implementer;
		if (mrAuthor !== implLogin && mrAuthor !== `${implLogin}[bot]`) {
			logger.info('MR not authored by implementer persona, skipping pipeline failure trigger', {
				mrIid,
				mrAuthor,
			});
			return null;
		}

		// Only trigger for MRs targeting the project's base branch
		if (mr.target_branch !== ctx.project.baseBranch) {
			logger.info('MR targets non-base branch, skipping pipeline failure trigger', {
				mrIid,
				targetBranch: mr.target_branch,
				projectBaseBranch: ctx.project.baseBranch,
			});
			return null;
		}

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, mrIid);

		// Check attempt limit to prevent infinite loops
		const attempts = fixAttempts.get(mrIid) || 0;
		if (attempts >= MAX_ATTEMPTS) {
			logger.warn('Max auto-fix attempts reached for MR', {
				mrIid,
				attempts,
			});
			return null;
		}

		// Increment attempt counter
		fixAttempts.set(mrIid, attempts + 1);

		// Collect failed build info for agent context
		const failedBuilds = (payload.builds ?? [])
			.filter((b) => b.status === 'failed' || b.status === 'canceled')
			.map((b) => b.name);

		logger.info('Pipeline failure on implementer MR — triggering respond-to-ci', {
			mrIid,
			workItemId,
			attempt: attempts + 1,
			pipelineId: payload.object_attributes.id,
			failedBuilds,
		});

		return {
			agentType: 'respond-to-ci',
			agentInput: {
				prNumber: mrIid,
				prBranch: mr.source_branch,
				repoFullName: payload.project.path_with_namespace,
				headSha,
				triggerType: 'check-failure',
				triggerEvent: 'scm:check-suite-failure',
				workItemId: workItemId,
			},
			prNumber: mrIid,
			prUrl: mr.url,
			prTitle: mr.title,
			workItemId,
		};
	}
}

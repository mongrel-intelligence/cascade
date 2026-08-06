/**
 * GitLab Pipeline Success trigger.
 *
 * Triggers the review agent when a pipeline succeeds on a MR.
 * Unlike GitHub's check_suite which fires per individual suite, GitLab pipelines
 * are atomic — a single pipeline webhook fires when the entire pipeline completes.
 * This means waitForChecks is not needed.
 */

import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';
import { type GitLabPipelinePayload, isGitLabPipelinePayload } from './types.js';
import { evaluateAuthorMode, resolveMergeRequestForPipeline, resolveWorkItemId } from './utils.js';

export class PipelineSuccessTrigger implements TriggerHandler {
	name = 'gitlab:pipeline-success';
	description = 'Triggers review agent when pipeline succeeds on a GitLab MR';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'gitlab') return false;
		if (!isGitLabPipelinePayload(ctx.payload)) return false;

		// Only trigger on successful pipelines
		if (ctx.payload.object_attributes.status !== 'success') return false;

		// MR association is checked in handle() via API fallback
		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check trigger config + get parameters in a single DB call
		const triggerConfig = await checkTriggerEnabledWithParams(
			ctx.project.id,
			'review',
			'scm:check-suite-success',
			this.name,
		);
		if (!triggerConfig.enabled) {
			return null;
		}

		const payload = ctx.payload as GitLabPipelinePayload;

		// Resolve MR — from payload or by looking up open MR for the branch
		const mr = await resolveMergeRequestForPipeline(payload);
		if (!mr) {
			logger.debug('No MR associated with successful pipeline, skipping', {
				handler: this.name,
				ref: payload.object_attributes.ref,
			});
			return null;
		}
		const mrIid = mr.iid;
		const mrAuthor = payload.user.username;
		const headSha = payload.object_attributes.sha;

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

		// Only trigger for MRs targeting the project's base branch
		if (mr.target_branch !== ctx.project.baseBranch) {
			logger.info('MR targets non-base branch, skipping pipeline success trigger', {
				mrIid,
				targetBranch: mr.target_branch,
				projectBaseBranch: ctx.project.baseBranch,
			});
			return null;
		}

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, mrIid);

		logger.info('Pipeline succeeded on MR, triggering review agent', {
			mrIid,
			mrTitle: mr.title,
			workItemId,
			pipelineId: payload.object_attributes.id,
		});

		return {
			agentType: 'review',
			agentInput: {
				prNumber: mrIid,
				prBranch: mr.source_branch,
				repoFullName: payload.project.path_with_namespace,
				headSha,
				triggerType: 'ci-success',
				triggerEvent: 'scm:check-suite-success',
				workItemId: workItemId,
			},
			prNumber: mrIid,
			prUrl: mr.url,
			prTitle: mr.title,
			workItemId,
		};
	}
}

import { githubClient } from '../../github/client.js';
import { getPMProvider } from '../../pm/context.js';
import { hasAutoLabel, resolveProjectPMConfig } from '../../pm/lifecycle.js';
import type { ProjectPMConfig } from '../../pm/lifecycle.js';
import type { PMProvider } from '../../pm/types.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { isLifecycleTriggerEnabled } from '../shared/lifecycle-check.js';
import {
	type GitHubCheckSuitePayload,
	type GitHubPullRequestReviewPayload,
	isGitHubCheckSuitePayload,
	isGitHubPullRequestReviewPayload,
} from './types.js';
import { resolveWorkItemId } from './utils.js';

/** Merge PR automatically and move to MERGED; fall back to DONE on merge failure. */
async function handleAutoMerge(
	owner: string,
	repo: string,
	prNumber: number,
	workItemId: string,
	provider: PMProvider,
	pmConfig: ProjectPMConfig,
): Promise<TriggerResult | null> {
	const mergedStatus = pmConfig.statuses.merged;
	if (!mergedStatus) {
		logger.warn(
			'No merged status configured for project (auto label present), falling back to DONE',
			{ workItemId },
		);
		const doneStatus = pmConfig.statuses.done;
		if (!doneStatus) {
			await provider.addComment(
				workItemId,
				'⚠️ Auto-merge requested (auto label present), but no MERGED or DONE status configured. Manual action required.',
			);
			return null;
		}
		await provider.moveWorkItem(workItemId, doneStatus);
		await provider.addComment(
			workItemId,
			'⚠️ Auto-merge requested (auto label present), but no MERGED status configured. Moved to DONE instead.',
		);
		return { agentType: null, agentInput: {}, workItemId, prNumber };
	}

	logger.info('Auto-merging PR and moving work item to MERGED', {
		workItemId,
		prNumber,
	});

	try {
		await githubClient.mergePR(owner, repo, prNumber);
	} catch (err) {
		logger.warn('Auto-merge failed, falling back to DONE', {
			workItemId,
			prNumber,
			error: String(err),
		});
		const doneStatus = pmConfig.statuses.done;
		if (!doneStatus) {
			await provider.addComment(
				workItemId,
				`⚠️ Auto-merge of PR #${prNumber} failed: ${String(err)}. No DONE status configured — manual action required.`,
			);
			return null;
		}
		await provider.moveWorkItem(workItemId, doneStatus);
		await provider.addComment(
			workItemId,
			`⚠️ Auto-merge of PR #${prNumber} failed: ${String(err)}. Moved to DONE instead.`,
		);
		return { agentType: null, agentInput: {}, workItemId, prNumber };
	}

	await provider.moveWorkItem(workItemId, mergedStatus);
	await provider.addComment(workItemId, `PR #${prNumber} automatically merged and moved to MERGED`);
	return { agentType: null, agentInput: {}, workItemId, prNumber };
}

export class PRReadyToMergeTrigger implements TriggerHandler {
	name = 'pr-ready-to-merge';
	description =
		'Moves work item to DONE (or auto-merges PR and moves to MERGED) when PR is approved and all checks pass';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;

		// Trigger on either check_suite completion (success) or review submission (approved)
		if (isGitHubCheckSuitePayload(ctx.payload)) {
			const payload = ctx.payload;
			// Only on completed check suites with success conclusion
			if (payload.action !== 'completed') return false;
			if (payload.check_suite.conclusion !== 'success') return false;
			if (payload.check_suite.pull_requests.length === 0) return false;
			return true;
		}

		if (isGitHubPullRequestReviewPayload(ctx.payload)) {
			const payload = ctx.payload;
			// Only on submitted reviews that are approvals
			if (payload.action !== 'submitted') return false;
			if (payload.review.state !== 'approved') return false;
			return true;
		}

		return false;
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: intentional — multiple review/check paths with auto-merge branching
	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check lifecycle trigger config (stored in project_integrations.triggers)
		if (!(await isLifecycleTriggerEnabled(ctx.project.id, 'prReadyToMerge', this.name))) {
			return null;
		}

		let prNumber: number;
		let headSha: string;
		let repoFullName: string;

		// Extract info based on payload type
		if (isGitHubCheckSuitePayload(ctx.payload)) {
			const payload = ctx.payload as GitHubCheckSuitePayload;
			const prRef = payload.check_suite.pull_requests[0];
			prNumber = prRef.number;
			headSha = prRef.head.sha;
			repoFullName = payload.repository.full_name;
		} else if (isGitHubPullRequestReviewPayload(ctx.payload)) {
			const payload = ctx.payload as GitHubPullRequestReviewPayload;
			prNumber = payload.pull_request.number;
			headSha = payload.pull_request.head.sha;
			repoFullName = payload.repository.full_name;
		} else {
			return null;
		}

		const { owner, repo } = parseRepoFullName(repoFullName);

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber);
		if (!workItemId) {
			logger.info('No work item linked to PR, skipping pr-ready-to-merge', { prNumber });
			return null;
		}

		// Check 1: All checks must pass
		const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, headSha);
		if (!checkStatus.allPassing) {
			logger.debug('Not all checks passing', {
				prNumber,
				totalChecks: checkStatus.totalCount,
				failing: checkStatus.checkRuns.filter((c) => c.conclusion !== 'success').map((c) => c.name),
			});
			return null;
		}

		// Check 2: Must have approved review and no outstanding change requests
		const reviews = await githubClient.getPRReviews(owner, repo, prNumber);

		// Get the latest review state per user (only count approved/changes_requested)
		const latestReviewByUser = new Map<string, string>();
		for (const review of reviews) {
			if (review.state === 'approved' || review.state === 'changes_requested') {
				latestReviewByUser.set(review.user.login, review.state);
			}
		}

		const hasApproval = Array.from(latestReviewByUser.values()).some((s) => s === 'approved');
		const hasChangeRequests = Array.from(latestReviewByUser.values()).some(
			(s) => s === 'changes_requested',
		);

		if (!hasApproval || hasChangeRequests) {
			logger.debug('PR not approved or has change requests', {
				prNumber,
				hasApproval,
				hasChangeRequests,
			});
			return null;
		}

		// All conditions met — check for auto label to determine MERGED vs DONE path
		const pmConfig = resolveProjectPMConfig(ctx.project);
		const provider = getPMProvider();
		const workItem = await provider.getWorkItem(workItemId);

		if (hasAutoLabel(workItem.labels, pmConfig)) {
			// Idempotency: skip if already in MERGED status
			const mergedStatus = pmConfig.statuses.merged;
			if (mergedStatus && workItem.status === mergedStatus) {
				logger.info('Work item already in MERGED status, skipping duplicate auto-merge', {
					workItemId,
					prNumber,
				});
				return { agentType: null, agentInput: {}, workItemId, prNumber };
			}
			return handleAutoMerge(owner, repo, prNumber, workItemId, provider, pmConfig);
		}

		// Standard path: move to DONE
		const doneStatus = pmConfig.statuses.done;
		if (!doneStatus) {
			logger.warn('No done status configured for project', { projectId: ctx.project.id });
			return null;
		}

		// Idempotency: skip if work item is already in the DONE status
		// (handles concurrent webhooks from multiple check_suite/review events)
		if (workItem.status === doneStatus) {
			logger.info('Work item already in DONE status, skipping duplicate move', {
				workItemId,
				prNumber,
			});
			return { agentType: null, agentInput: {}, workItemId, prNumber };
		}

		logger.info('Moving work item to DONE - PR approved and all checks passing', {
			workItemId,
			prNumber,
			repoFullName,
		});

		await provider.moveWorkItem(workItemId, doneStatus);
		await provider.addComment(
			workItemId,
			`PR #${prNumber} approved and all checks passing - moved to DONE`,
		);

		// Return result without agentType (no agent to run)
		return { agentType: null, agentInput: {}, workItemId, prNumber };
	}
}

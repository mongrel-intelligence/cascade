import { type CheckSuiteStatus, githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';
import { type GitHubCheckSuitePayload, isGitHubCheckSuitePayload } from './types.js';
import { evaluateAuthorMode, resolveWorkItemId } from './utils.js';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 10_000;

/** In-memory dedup for review triggers on the same PR+SHA (prevents duplicate reviews from multiple check_suite webhooks) */
export const recentlyDispatched = new Map<string, number>();
const DEDUP_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Wait for all check suites to complete, retrying when some are still in-progress.
 * Returns immediately if all checks have completed (whether passing or failing).
 *
 * Called by the worker before starting the review agent (not in the trigger handler).
 */
export async function waitForChecks(
	owner: string,
	repo: string,
	headSha: string,
	prNumber: number,
): Promise<CheckSuiteStatus> {
	let checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, headSha);
	if (checkStatus.allPassing) return checkStatus;

	const hasInProgress = checkStatus.checkRuns.some((c) => c.status !== 'completed');
	if (!hasInProgress) return checkStatus;

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		logger.info('Some checks still in progress, retrying', {
			prNumber,
			attempt,
			maxRetries: MAX_RETRIES,
			pending: checkStatus.checkRuns.filter((c) => c.status !== 'completed').map((c) => c.name),
		});
		await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
		checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, headSha);
		if (checkStatus.allPassing) break;

		// If all completed but some failed, no point retrying
		const stillRunning = checkStatus.checkRuns.some((c) => c.status !== 'completed');
		if (!stillRunning) break;
	}

	return checkStatus;
}

/**
 * Triggers review agent when all CI checks pass on a PR authored by the implementer persona.
 *
 * This trigger fires when:
 * 1. A check_suite completes with success conclusion
 * 2. The PR author matches the configured author mode (own/external/all)
 * 3. All checks are actually passing (verified via API)
 *
 * Work item resolution uses the pr_work_items DB table (with PR body extraction as fallback).
 * The trigger fires even without a linked work item — agents run, PM updates are simply skipped.
 *
 * Registration order matters - this should be registered BEFORE PRReadyToMergeTrigger
 * so the review happens before the card is moved to DONE.
 */
export class CheckSuiteSuccessTrigger implements TriggerHandler {
	name = 'check-suite-success';
	description = 'Triggers review agent when all CI checks pass on a PR by the implementer persona';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubCheckSuitePayload(ctx.payload)) return false;

		const payload = ctx.payload;

		// Only trigger on completed check suites with success conclusion
		if (payload.action !== 'completed') return false;
		if (payload.check_suite.conclusion !== 'success') return false;

		// Must have at least one associated PR
		if (payload.check_suite.pull_requests.length === 0) return false;

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

		const payload = ctx.payload as GitHubCheckSuitePayload;
		const { owner, repo } = parseRepoFullName(payload.repository.full_name);

		// Get the first associated PR (usually there's only one)
		const prRef = payload.check_suite.pull_requests[0];
		const prNumber = prRef.number;
		const headSha = payload.check_suite.head_sha;

		// Fetch PR details
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		// Gate on PR author based on configured authorMode parameter
		const authorResult = evaluateAuthorMode(
			prDetails.user.login,
			ctx.personaIdentities,
			triggerConfig.parameters,
			this.name,
		);
		if (!authorResult) {
			return null;
		}
		if (!authorResult.shouldTrigger) {
			logger.info('PR author does not match configured authorMode, skipping', {
				handler: this.name,
				prNumber,
				prAuthor: prDetails.user.login,
				isImplementerPR: authorResult.isImplementerPR,
				authorMode: authorResult.authorMode,
			});
			return null;
		}

		// Only trigger for PRs targeting the project's base branch
		if (prDetails.baseRef !== ctx.project.baseBranch) {
			logger.info('PR targets non-base branch, skipping review trigger', {
				prNumber,
				baseRef: prDetails.baseRef,
				projectBaseBranch: ctx.project.baseBranch,
			});
			return null;
		}

		// Resolve work item from DB (with PR body fallback)
		const workItemId = await resolveWorkItemId(
			ctx.project.id,
			prNumber,
			prDetails.body,
			ctx.project,
		);

		// Skip if the reviewer persona's latest review already covers the current HEAD SHA
		const reviews = await githubClient.getPRReviews(owner, repo, prNumber);

		// Use persona identities to identify reviewer bot's reviews
		// (evaluateAuthorMode above already verified personaIdentities exists)
		const reviewerUsername = ctx.personaIdentities?.reviewer;

		// Only consider actual reviews (approved/changes_requested), not COMMENTED
		// which are reply acknowledgments posted by respond-to-review agent
		const ourReviews = reviews.filter(
			(r) =>
				reviewerUsername &&
				r.user.login === reviewerUsername &&
				(r.state === 'approved' || r.state === 'changes_requested'),
		);
		if (ourReviews.length > 0) {
			const latestReview = ourReviews[ourReviews.length - 1];
			if (latestReview.commitId === headSha) {
				logger.info('PR already reviewed at current HEAD, skipping', {
					prNumber,
					reviewerUsername,
					headSha,
				});
				return null;
			}
			logger.info('New commits since last review, re-triggering review', {
				prNumber,
				lastReviewCommit: latestReview.commitId,
				headSha,
			});
		}

		// In-memory dedup: skip if we already dispatched a review for this PR+SHA
		const dedupKey = `${owner}/${repo}:${prNumber}:${headSha}`;
		const now = Date.now();
		for (const [key, ts] of recentlyDispatched) {
			if (now - ts > DEDUP_TTL_MS) recentlyDispatched.delete(key);
		}
		if (recentlyDispatched.has(dedupKey)) {
			logger.info('Review already dispatched for this PR+SHA, skipping', { prNumber, headSha });
			return null;
		}
		recentlyDispatched.set(dedupKey, now);

		// The trigger decision is made — the review agent should run.
		// Actual check polling (waitForChecks) is deferred to the worker via the flag.
		// GitHub fires a check_suite webhook per individual suite completion.
		// When multiple suites exist, the first webhook arrives before other suites finish.
		// The worker will poll until all checks pass before starting the agent.
		logger.info('Check-suite success trigger matched — deferring check polling to worker', {
			prNumber,
			workItemId,
			headSha,
		});

		return {
			agentType: 'review',
			agentInput: {
				prNumber,
				prBranch: prRef.head.ref,
				repoFullName: payload.repository.full_name,
				headSha,
				triggerType: 'ci-success',
				cardId: workItemId,
			},
			prNumber,
			workItemId,
			waitForChecks: true,
		};
	}
}

import { resolveGitHubTriggerEnabled } from '../../config/triggerConfig.js';
import { type CheckSuiteStatus, githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { type GitHubCheckSuitePayload, isGitHubCheckSuitePayload } from './types.js';
import { extractTrelloCardId, hasTrelloCardUrl } from './utils.js';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 10_000;

/**
 * Wait for all check suites to complete, retrying when some are still in-progress.
 * Returns immediately if all checks have completed (whether passing or failing).
 */
async function waitForChecks(
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
 * Triggers review agent when all CI checks pass on a PR with Trello card URL.
 *
 * This trigger fires when:
 * 1. A check_suite completes with success conclusion
 * 2. The associated PR has a Trello card URL in its body
 * 3. All checks are actually passing (verified via API)
 *
 * Registration order matters - this should be registered BEFORE PRReadyToMergeTrigger
 * so the review happens before the card is moved to DONE.
 */
export class CheckSuiteSuccessTrigger implements TriggerHandler {
	name = 'check-suite-success';
	description = 'Triggers review agent when all CI checks pass on a PR with Trello card';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubCheckSuitePayload(ctx.payload)) return false;

		// Check trigger config — default enabled for backward compatibility
		if (!resolveGitHubTriggerEnabled(ctx.project.github?.triggers, 'checkSuiteSuccess')) {
			return false;
		}

		const payload = ctx.payload;

		// Only trigger on completed check suites with success conclusion
		if (payload.action !== 'completed') return false;
		if (payload.check_suite.conclusion !== 'success') return false;

		// Must have at least one associated PR
		if (payload.check_suite.pull_requests.length === 0) return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const payload = ctx.payload as GitHubCheckSuitePayload;
		const [owner, repo] = payload.repository.full_name.split('/');

		// Get the first associated PR (usually there's only one)
		const prRef = payload.check_suite.pull_requests[0];
		const prNumber = prRef.number;
		const headSha = payload.check_suite.head_sha;

		// Fetch PR to check for Trello card URL
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		if (!hasTrelloCardUrl(prDetails.body)) {
			logger.info('PR does not have Trello card URL, skipping CI success trigger', {
				prNumber,
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

		const cardId = extractTrelloCardId(prDetails.body);

		// Skip if the reviewer persona's latest review already covers the current HEAD SHA
		const reviews = await githubClient.getPRReviews(owner, repo, prNumber);

		// Use persona identities to identify reviewer bot's reviews
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

		// Verify all checks are actually passing (double-check)
		// Uses the implementer token already in scope (set by webhook-handler),
		// which has actions:read permission. The reviewer's fine-grained PAT may not.
		//
		// GitHub fires a check_suite webhook per individual suite completion.
		// When multiple suites exist, the first webhook arrives before other suites finish.
		// waitForChecks retries when checks are still in-progress, but bails on genuine failures.
		const checkStatus = await waitForChecks(owner, repo, headSha, prNumber);

		if (!checkStatus.allPassing) {
			logger.info('Not all checks passing, skipping review trigger', {
				prNumber,
				totalChecks: checkStatus.totalCount,
				failing: checkStatus.checkRuns.filter((c) => c.conclusion !== 'success').map((c) => c.name),
			});
			return null;
		}

		logger.info('All CI checks passed on PR with Trello card - triggering review', {
			prNumber,
			cardId,
			headSha,
			totalChecks: checkStatus.totalCount,
		});

		return {
			agentType: 'review',
			agentInput: {
				prNumber,
				prBranch: prRef.head.ref,
				repoFullName: payload.repository.full_name,
				headSha,
				triggerType: 'ci-success',
				cardId: cardId || undefined,
			},
			prNumber,
			cardId: cardId || undefined,
		};
	}
}

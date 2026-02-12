import { getAuthenticatedUser, getReviewerUser, githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { type GitHubCheckSuitePayload, isGitHubCheckSuitePayload } from './types.js';
import { extractTrelloCardId, hasTrelloCardUrl } from './utils.js';

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

		const cardId = extractTrelloCardId(prDetails.body);

		// Skip if our latest review already covers the current HEAD SHA
		const [reviews, botUser, reviewerUser] = await Promise.all([
			githubClient.getPRReviews(owner, repo, prNumber),
			getAuthenticatedUser(),
			getReviewerUser(ctx.project.reviewerTokenEnv),
		]);

		const ourReviews = reviews.filter(
			(r) => r.user.login === botUser || (reviewerUser && r.user.login === reviewerUser),
		);
		if (ourReviews.length > 0) {
			const latestReview = ourReviews[ourReviews.length - 1];
			if (latestReview.commitId === headSha) {
				logger.info('PR already reviewed at current HEAD, skipping', {
					prNumber,
					botUser,
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
		const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, headSha);

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

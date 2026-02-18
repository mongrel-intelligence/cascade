import { githubClient } from '../../github/client.js';
import { trelloClient } from '../../trello/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import {
	type GitHubCheckSuitePayload,
	type GitHubPullRequestReviewPayload,
	isGitHubCheckSuitePayload,
	isGitHubPullRequestReviewPayload,
} from './types.js';
import { extractTrelloCardId, hasTrelloCardUrl } from './utils.js';

export class PRReadyToMergeTrigger implements TriggerHandler {
	name = 'pr-ready-to-merge';
	description = 'Moves Trello card to DONE when PR is approved and all checks pass';

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

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		let prNumber: number;
		let headSha: string;
		let repoFullName: string;
		let prBody: string | null;

		// Extract info based on payload type
		if (isGitHubCheckSuitePayload(ctx.payload)) {
			const payload = ctx.payload as GitHubCheckSuitePayload;
			const prRef = payload.check_suite.pull_requests[0];
			prNumber = prRef.number;
			headSha = prRef.head.sha;
			repoFullName = payload.repository.full_name;

			// Need to fetch PR to get body
			const [owner, repo] = repoFullName.split('/');
			const prDetails = await githubClient.getPR(owner, repo, prNumber);
			prBody = prDetails.body;
		} else if (isGitHubPullRequestReviewPayload(ctx.payload)) {
			const payload = ctx.payload as GitHubPullRequestReviewPayload;
			prNumber = payload.pull_request.number;
			headSha = payload.pull_request.head.sha;
			repoFullName = payload.repository.full_name;
			prBody = payload.pull_request.body;
		} else {
			return null;
		}

		const [owner, repo] = repoFullName.split('/');

		// Must have Trello card URL
		if (!hasTrelloCardUrl(prBody)) {
			logger.debug('PR does not have Trello card URL', { prNumber });
			return null;
		}

		const cardId = extractTrelloCardId(prBody);
		if (!cardId) return null;

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

		// All conditions met - move card to DONE
		const doneListId = ctx.project.trello?.lists?.done;
		if (!doneListId) {
			logger.warn('No done list configured for project', { projectId: ctx.project.id });
			return null;
		}

		// Idempotency: skip if card is already in the DONE list
		// (handles concurrent webhooks from multiple check_suite/review events)
		const card = await trelloClient.getCard(cardId);
		if (card.idList === doneListId) {
			logger.info('Card already in DONE list, skipping duplicate move', {
				cardId,
				prNumber,
			});
			return {
				agentType: '',
				agentInput: {},
				cardId,
				prNumber,
			};
		}

		logger.info('Moving card to DONE - PR approved and all checks passing', {
			cardId,
			prNumber,
			repoFullName,
		});

		await trelloClient.moveCardToList(cardId, doneListId);
		await trelloClient.addComment(
			cardId,
			`PR #${prNumber} approved and all checks passing - moved to DONE`,
		);

		// Return result without agentType (no agent to run)
		return {
			agentType: '', // Empty string signals no agent needed
			agentInput: {},
			cardId,
			prNumber,
		};
	}
}

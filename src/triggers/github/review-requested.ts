import { isCascadeBot } from '../../github/personas.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { gateTriggerEnabled, requirePersonaIdentities } from '../shared/gates.js';
import { skip } from '../shared/skip.js';
import {
	buildReviewDispatchKey,
	claimReviewDispatch,
	releaseReviewDispatch,
} from './review-dispatch-dedup.js';
import { type GitHubPullRequestPayload, isGitHubPullRequestPayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

/**
 * Trigger that fires the review agent when review is requested from a CASCADE persona account.
 *
 * This trigger:
 * 1. Fires on `pull_request.review_requested` events
 * 2. Rejects requests sent by CASCADE personas (loop prevention)
 * 3. Checks if the requested reviewer is a CASCADE persona (implementer OR reviewer)
 * 4. Fires the `review` agent with PR number and work item ID from DB lookup
 *
 * Default: **disabled** (opt-in via trigger config).
 *
 * Registration: this may race with CheckSuiteSuccessTrigger for the same PR head SHA.
 * Shared PR+SHA dispatch dedup ensures only one review agent is launched.
 */
export class ReviewRequestedTrigger implements TriggerHandler {
	name = 'review-requested';
	description = 'Triggers review agent when review is requested from a CASCADE persona account';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubPullRequestPayload(ctx.payload)) return false;

		// Only trigger on review_requested events
		if (ctx.payload.action !== 'review_requested') return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		const enabled = await gateTriggerEnabled(
			ctx.project.id,
			'review',
			'scm:review-requested',
			this.name,
		);
		if (enabled) return enabled;

		const payload = ctx.payload as GitHubPullRequestPayload;
		const prNumber = payload.pull_request.number;
		const headSha = payload.pull_request.head.sha;
		const repoFullName = payload.repository.full_name;
		const [owner, repo] = repoFullName.split('/', 2);

		const personasResult = requirePersonaIdentities(ctx.personaIdentities, prNumber, this.name);
		if (!personasResult.ok) return personasResult.skip;
		const personas = personasResult.value;

		// Skip review requests FROM CASCADE personas (self-loop prevention)
		const senderLogin = payload.sender.login;
		if (isCascadeBot(senderLogin, personas)) {
			logger.info('Skipping review request from CASCADE persona (loop prevention)', {
				prNumber,
				sender: senderLogin,
				requestedReviewer: payload.requested_reviewer?.login,
			});
			return skip(
				this.name,
				`Review request on PR #${prNumber} sent BY cascade persona ${senderLogin} (loop prevention)`,
			);
		}

		// Check if the requested reviewer is a CASCADE persona
		const requestedReviewer = payload.requested_reviewer?.login;
		if (!requestedReviewer) {
			logger.debug('No requested reviewer in payload, skipping', { prNumber });
			return skip(
				this.name,
				`Review request on PR #${prNumber} has no requested_reviewer in payload`,
			);
		}

		if (!isCascadeBot(requestedReviewer, personas)) {
			logger.debug('Requested reviewer is not a CASCADE persona, skipping', {
				prNumber,
				requestedReviewer,
				personas,
			});
			return skip(
				this.name,
				`Review request on PR #${prNumber} is for ${requestedReviewer}, not a cascade persona — not auto-triggering`,
			);
		}

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber);
		const reviewDispatchKey = buildReviewDispatchKey(owner, repo, prNumber, headSha);
		// Human-initiated review requests override any prior automated dispatch claim.
		releaseReviewDispatch(reviewDispatchKey);
		if (!claimReviewDispatch(reviewDispatchKey, this.name, { prNumber, headSha })) {
			return skip(
				this.name,
				`Review dispatch for PR #${prNumber}@${headSha} already claimed by another path (dedup)`,
			);
		}

		logger.info('Review requested from CASCADE persona, triggering review agent', {
			prNumber,
			requestedReviewer,
			workItemId,
			headSha,
		});

		return {
			agentType: 'review',
			agentInput: {
				prNumber,
				prBranch: payload.pull_request.head.ref,
				repoFullName,
				headSha,
				triggerType: 'review-requested',
				triggerEvent: 'scm:review-requested',
				workItemId: workItemId,
			},
			prNumber,
			prUrl: payload.pull_request.html_url,
			prTitle: payload.pull_request.title,
			workItemId,
			onBlocked: () => releaseReviewDispatch(reviewDispatchKey),
		};
	}
}

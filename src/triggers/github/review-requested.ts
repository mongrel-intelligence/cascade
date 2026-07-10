import { isCascadeBot } from '../../github/personas.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { requirePersonaIdentities } from '../shared/gates.js';
import { skip } from '../shared/skip.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import {
	buildReviewDispatchKey,
	claimReviewDispatch,
	releaseReviewDispatch,
} from './review-dispatch-dedup.js';
import { type GitHubPullRequestPayload, isGitHubPullRequestPayload } from './types.js';
import { resolveWorkItemIdWithFallback } from './utils.js';

/**
 * Trigger that fires the review agent when review is requested from a CASCADE persona account.
 *
 * This trigger:
 * 1. Fires on `pull_request.review_requested` events
 * 2. Rejects requests sent by CASCADE personas (loop prevention) — EXCEPT a
 *    self-directed request where `sender === requested_reviewer` (see below)
 * 3. Checks if the requested reviewer is a CASCADE persona (implementer OR reviewer)
 * 4. Fires the `review` agent with PR number and work item ID from DB lookup
 *
 * ## Self-directed exemption (shared-reviewer-token contributor)
 *
 * When the sender IS the requested reviewer and both resolve to a CASCADE
 * persona, the event is a human — whose GitHub account also holds the shared
 * `GITHUB_TOKEN_REVIEWER` — re-requesting *their own* review. The sender
 * loop-prevention guard exempts this case so it falls through to the normal
 * dispatch path instead of being silently skipped.
 *
 * This exemption cannot reintroduce a bot loop, because:
 * - **CASCADE never programmatically calls GitHub's "request reviewers" API.**
 *   There is no `requestReviewers` call anywhere in `src/`, so every
 *   `review_requested` event is human-initiated by construction.
 * - **A review *submission* by a persona emits `pull_request_review`, not
 *   `review_requested`.** An agent finishing a review therefore cannot re-fire
 *   this trigger.
 * - **Dispatch is deduped per PR+SHA** via `claimReviewDispatch` /
 *   `releaseReviewDispatch`, so even a duplicate delivery is a no-op.
 *
 * Cross-persona requests (`sender !== requested_reviewer`, e.g. an
 * implementer-authored PR auto-assigning the reviewer persona) are NOT exempt
 * and still skip with the loop-prevention reason.
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
		// Disabled-at-config returns null so the registry's first-match loop
		// continues to the next matcher — see `src/triggers/shared/trigger-check.ts`
		// for the disabled-shadowing contract.
		if (!(await checkTriggerEnabled(ctx.project.id, 'review', 'scm:review-requested', this.name))) {
			return null;
		}

		const payload = ctx.payload as GitHubPullRequestPayload;
		const prNumber = payload.pull_request.number;
		const headSha = payload.pull_request.head.sha;
		const repoFullName = payload.repository.full_name;
		const [owner, repo] = repoFullName.split('/', 2);

		const personasResult = requirePersonaIdentities(ctx.personaIdentities, prNumber, this.name);
		if (!personasResult.ok) return personasResult.skip;
		const personas = personasResult.value;

		// Hoisted above the sender guard so a self-directed request can be
		// detected before the loop-prevention skip decision is made.
		const senderLogin = payload.sender.login;
		const requestedReviewer = payload.requested_reviewer?.login;

		// A self-directed request is one where the sender IS the requested
		// reviewer. GitHub forbids requesting a review from the PR author, so the
		// precise mechanic is `sender === requested_reviewer` (not authorship).
		// This is always human-initiated: CASCADE never programmatically calls
		// GitHub's "request reviewers" API (no `requestReviewers` in `src/`), and
		// a persona *submitting* a review emits `pull_request_review`, not
		// `review_requested` — so this cannot be a bot re-firing the trigger.
		// Dispatch is additionally deduped per PR+SHA below, so a duplicate
		// delivery is a no-op. See the class JSDoc for the full rationale.
		const isSelfDirectedReviewRequest = !!requestedReviewer && senderLogin === requestedReviewer;

		// Skip review requests FROM CASCADE personas (self-loop prevention),
		// EXCEPT self-directed requests (a human using the shared reviewer token
		// re-requesting their own review), which fall through to dispatch.
		if (isCascadeBot(senderLogin, personas) && !isSelfDirectedReviewRequest) {
			logger.info('Skipping review request from CASCADE persona (loop prevention)', {
				prNumber,
				sender: senderLogin,
				requestedReviewer,
			});
			return skip(
				this.name,
				`Review request on PR #${prNumber} sent BY cascade persona ${senderLogin} (loop prevention)`,
			);
		}

		// Check if the requested reviewer is a CASCADE persona. A non-persona
		// self-request (sender === requested_reviewer but not a CASCADE persona)
		// still skips here with the not-a-cascade-persona reason.
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

		// Resolve work item: DB link, else derive the JIRA key from the PR itself
		// (branch / title / last body line) so review-only projects link human PRs.
		const workItemId = await resolveWorkItemIdWithFallback(ctx.project, prNumber, {
			branch: payload.pull_request.head.ref,
			title: payload.pull_request.title,
			body: payload.pull_request.body,
		});
		const reviewDispatchKey = buildReviewDispatchKey(owner, repo, prNumber, headSha);
		// Human-initiated review requests override any prior automated dispatch claim.
		await releaseReviewDispatch(reviewDispatchKey);
		if (!(await claimReviewDispatch(reviewDispatchKey, this.name, { prNumber, headSha }))) {
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
			onBlocked: () => {
				void releaseReviewDispatch(reviewDispatchKey);
			},
		};
	}
}

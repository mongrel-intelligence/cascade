import { githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { buildDeferredRecheckResult } from '../shared/result-builders.js';
import { skip } from '../shared/skip.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';
import { decideCheckSuiteGates, decideCheckSuiteOutcome } from './check-suite-decision.js';
import { resolveCheckSuitePRNumber } from './pr-resolution.js';
import { dispatchRespondToCi } from './respond-to-ci-dispatch.js';
import { buildReviewResult } from './result-builders.js';
import {
	buildReviewDispatchKey,
	claimReviewDispatch,
	releaseReviewDispatch,
} from './review-dispatch-dedup.js';
import { type GitHubCheckSuitePayload, isGitHubCheckSuitePayload } from './types.js';
import {
	parsePrNumberFromRef,
	resolveWorkItemDisplayData,
	resolveWorkItemIdWithFallback,
} from './utils.js';

/**
 * Dispatches an outcome agent when a check_suite completes with success
 * conclusion on a PR authored by the implementer persona.
 *
 * Three outcomes, chosen from aggregate state across ALL check_runs on the
 * head SHA — never just from this individual suite. The LAST check_suite
 * event for the SHA (regardless of polarity) is the one that makes the
 * dispatch decision. Mirrors `check-suite-failure.handle`'s defer-on-
 * incomplete shape.
 *
 * - `respond-to-ci` — every check is complete AND at least one failed.
 *                     Closes the gap where GitHub fires the success
 *                     event last after a fast-failing sibling suite, and no
 *                     later `conclusion=failure` event will fire to wake
 *                     `check-suite-failure`.
 * - `review`        — every completed check passes.
 * - skip            — some checks still in-progress. The next check_suite
 *                     event for the SHA will re-evaluate aggregate state.
 *                     No worker spawned; no dedup claimed; no orphan ack
 *                     comment posted.
 *
 * Why no worker-side polling: PR #1245 (2026-05-01) shipped a doomed worker
 * because the success handler dispatched on the FIRST event (CodeQL completing)
 * while CI was still running. The worker polled 12×10s and bailed; the dedup
 * then blocked the legitimate later success event from re-dispatching.
 * Deferring at the handler layer makes that whole class of bug impossible.
 *
 * The trigger fires when:
 * 1. A check_suite completes with success conclusion
 * 2. The PR author matches the configured author mode (own/external/all)
 *
 * Work item resolution uses the pr_work_items DB table only.
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

		// Must have at least one associated PR, or head_branch must be a refs/pull/{N}/head ref.
		const hasPrs = payload.check_suite.pull_requests.length > 0;
		const hasPrRef = parsePrNumberFromRef(payload.check_suite.head_branch) !== null;
		if (!hasPrs && !hasPrRef) return false;

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
			// Disabled-at-config returns null (not a structured skip) so
			// the registry's first-match loop can continue to the next
			// matcher. See `src/triggers/shared/trigger-check.ts` for the
			// disabled-shadowing contract.
			return null;
		}

		const payload = ctx.payload as GitHubCheckSuitePayload;
		const { owner, repo } = parseRepoFullName(payload.repository.full_name);

		const prResolution = await resolveCheckSuitePRNumber({
			owner,
			repo,
			pullRequests: payload.check_suite.pull_requests,
			headBranch: payload.check_suite.head_branch,
			handlerName: this.name,
			lookupOpenPRByBranch: githubClient.getOpenPRByBranch,
		});
		if (!prResolution.ok) {
			return skip(this.name, 'Could not parse PR number from check_suite head_branch');
		}
		const prNumber = prResolution.prNumber;
		const headSha = payload.check_suite.head_sha;

		// Fetch PR details
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		const gateDecision = decideCheckSuiteGates({
			prNumber,
			prAuthorLogin: prDetails.user.login,
			prBaseRef: prDetails.baseRef,
			project: ctx.project,
			personaIdentities: ctx.personaIdentities,
			handlerName: this.name,
			mode: { kind: 'review', parameters: triggerConfig.parameters },
		});
		if (gateDecision) {
			logger.info('Check-suite success gate skipped dispatch', {
				handler: this.name,
				prNumber,
				message: gateDecision.message,
			});
			return skip(this.name, gateDecision.message);
		}

		// Resolve work item: DB link, else derive the JIRA key from the PR itself.
		const workItemId = await resolveWorkItemIdWithFallback(ctx.project, prNumber, {
			branch: prDetails.headRef,
			title: prDetails.title,
			body: prDetails.body,
		});
		const { workItemUrl, workItemTitle } = await resolveWorkItemDisplayData(workItemId);

		// Aggregate-state fork. GitHub fires check_suite.completed once per
		// workflow; the LAST event to arrive (regardless of polarity) is the
		// one that makes the dispatch decision. Three outcomes:
		//   - !allComplete       → defer (skip). Next event re-evaluates.
		//   - allComplete + any failed → respond-to-ci (closes the gap where
		//                          a fast-failing sibling suite would lose
		//                          dispatch — see PR #176 incident).
		//   - allComplete + all passing → review.
		// No `waitForChecks: true` worker-side polling — that path was deleted
		// after PR #1245 (2026-05-01) where the worker polled 2 min, bailed,
		// and the cross-process dedup blocked all retries.
		const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, headSha);
		const decision = decideCheckSuiteOutcome({
			checkStatus,
			prNumber,
			prAuthorLogin: prDetails.user.login,
			prBaseRef: prDetails.baseRef,
			project: ctx.project,
			personaIdentities: ctx.personaIdentities,
			handlerName: this.name,
			mode: { kind: 'review', parameters: triggerConfig.parameters },
		});

		if (decision.action === 'defer') {
			// Bug 1 (2026-05-11 prod incident on ucho PR #394, MNG-683):
			// returning a plain skip() relies on GitHub firing another
			// check_suite event when the final suite completes. But when
			// the Actions API lags webhook delivery, the API still shows
			// the final suite as "in_progress" at query time AND no further
			// webhook arrives (GitHub already fired its one event for that
			// workflow). Schedule a deferred re-check so the trigger
			// re-evaluates against fresh API state ~30s later.
			const coalesceKey = `check-suite-success:${owner}/${repo}:pr-${prNumber}:${headSha}`;
			logger.info('Not all checks complete yet, scheduling deferred re-check', {
				handler: this.name,
				prNumber,
				totalChecks: checkStatus.totalCount,
				incompleteChecks: decision.incompleteChecks,
				coalesceKey,
				delayMs: 30_000,
			});
			return buildDeferredRecheckResult({
				delayMs: 30_000,
				coalesceKey,
				recheckKind: 'check-suite',
			});
		}

		if (decision.action === 'skip') {
			return skip(this.name, decision.message);
		}

		if (decision.action === 'respond-to-ci') {
			return dispatchRespondToCi({
				ctx,
				prNumber,
				prDetails,
				payload,
				workItemId,
				workItemUrl,
				workItemTitle,
				checkStatus,
				handlerName: this.name,
			});
		}

		// decision.action === 'review'
		// allComplete && !anyFailed → review path. Skip if the reviewer
		// persona's latest review already covers the current HEAD SHA.
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
				return skip(
					this.name,
					`PR #${prNumber} already reviewed at HEAD ${headSha} by ${reviewerUsername} — no re-review needed`,
				);
			}
			logger.info('New commits since last review, re-triggering review', {
				prNumber,
				lastReviewCommit: latestReview.commitId,
				headSha,
			});
		}

		// PR+SHA-scoped dedup prevents duplicate reviews across both duplicate
		// check_suite deliveries and other review-producing triggers — including
		// the post-completion-hook in the IMPL worker process. Backed by Redis
		// so the dedup holds across processes (router + workers + future replicas).
		const dedupKey = buildReviewDispatchKey(owner, repo, prNumber, headSha);
		if (!(await claimReviewDispatch(dedupKey, this.name, { prNumber, headSha }))) {
			return skip(
				this.name,
				`Review dispatch for PR #${prNumber}@${headSha} already claimed by another path (dedup)`,
			);
		}

		// Aggregate state is already verified all-passing at this point — no
		// worker-side polling needed. Dispatch immediately.
		logger.info('Check-suite success trigger matched — dispatching review', {
			prNumber,
			workItemId,
			headSha,
		});

		return buildReviewResult({
			prNumber,
			prDetails,
			repoFullName: payload.repository.full_name,
			headSha,
			workItemId,
			workItemUrl,
			workItemTitle,
			onBlocked: () => {
				// Fire-and-forget — release is best-effort and the TTL is the safety net.
				void releaseReviewDispatch(dedupKey);
			},
		});
	}
}

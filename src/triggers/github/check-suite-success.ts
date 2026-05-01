import { githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { gateBaseBranch } from '../shared/gates.js';
import { skip } from '../shared/skip.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';
import { dispatchRespondToCi } from './respond-to-ci-dispatch.js';
import {
	buildReviewDispatchKey,
	claimReviewDispatch,
	releaseReviewDispatch,
} from './review-dispatch-dedup.js';
import { type GitHubCheckSuitePayload, isGitHubCheckSuitePayload } from './types.js';
import {
	evaluateAuthorMode,
	parsePrNumberFromRef,
	resolveWorkItemDisplayData,
	resolveWorkItemId,
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

		// Must have at least one associated PR, or head_branch must be a refs/pull/{N}/head ref
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
			return skip(this.name, 'review trigger is disabled for this project');
		}

		const payload = ctx.payload as GitHubCheckSuitePayload;
		const { owner, repo } = parseRepoFullName(payload.repository.full_name);

		// Resolve PR number — from payload directly, or by parsing refs/pull/{N}/head
		let prNumber: number;
		if (payload.check_suite.pull_requests.length > 0) {
			prNumber = payload.check_suite.pull_requests[0].number;
		} else {
			const parsed = parsePrNumberFromRef(payload.check_suite.head_branch);
			if (parsed === null) {
				logger.info('Could not parse PR number from head_branch ref, skipping', {
					handler: this.name,
				});
				return skip(this.name, 'Could not parse PR number from check_suite head_branch');
			}
			prNumber = parsed;
		}
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
			return skip(
				this.name,
				'Cascade persona identities could not be resolved (token / GitHub API issue)',
			);
		}
		if (!authorResult.shouldTrigger) {
			logger.info('PR author does not match configured authorMode, skipping', {
				handler: this.name,
				prNumber,
				prAuthor: prDetails.user.login,
				isCascadePR: authorResult.isCascadePR,
				authorMode: authorResult.authorMode,
			});
			return skip(
				this.name,
				`PR #${prNumber} author ${prDetails.user.login} does not match configured authorMode '${authorResult.authorMode}' (isCascadePR=${authorResult.isCascadePR})`,
			);
		}

		const baseSkip = gateBaseBranch(prDetails.baseRef, prNumber, ctx.project, this.name);
		if (baseSkip) return baseSkip;

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber);
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
		const allComplete = checkStatus.checkRuns.every((cr) => cr.status === 'completed');
		const anyFailed = checkStatus.checkRuns.some(
			(cr) =>
				cr.conclusion === 'failure' ||
				cr.conclusion === 'timed_out' ||
				cr.conclusion === 'action_required',
		);

		if (!allComplete) {
			const incomplete = checkStatus.checkRuns
				.filter((cr) => cr.status !== 'completed')
				.map((cr) => cr.name);
			logger.info('Not all checks complete yet, waiting for next check_suite event', {
				handler: this.name,
				prNumber,
				totalChecks: checkStatus.totalCount,
				incompleteChecks: incomplete,
			});
			return skip(
				this.name,
				`Not all checks complete yet (${incomplete.length}/${checkStatus.totalCount} still running): ${incomplete.join(', ')}`,
			);
		}

		if (anyFailed) {
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

		const prBranch = prDetails.headRef;

		return {
			agentType: 'review',
			agentInput: {
				prNumber,
				prBranch,
				repoFullName: payload.repository.full_name,
				headSha,
				triggerType: 'ci-success',
				triggerEvent: 'scm:check-suite-success',
				workItemId: workItemId,
			},
			prNumber,
			prUrl: prDetails.htmlUrl,
			prTitle: prDetails.title,
			workItemId,
			workItemUrl,
			workItemTitle,
			onBlocked: () => {
				// Fire-and-forget — release is best-effort and the TTL is the safety net.
				void releaseReviewDispatch(dedupKey);
			},
		};
	}
}

import { type CheckSuiteStatus, githubClient } from '../../github/client.js';
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

const MAX_RETRIES = 12;
const RETRY_DELAY_MS = 10_000;

export { recentlyDispatched } from './review-dispatch-dedup.js';

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
 * Dispatches an outcome agent when a check_suite completes with success
 * conclusion on a PR authored by the implementer persona.
 *
 * Two outcomes — chosen from aggregate state across ALL check_runs on the
 * head SHA, not just this suite's:
 * - `review`              — every completed check passes, OR some are still
 *                           in-progress (defer to worker via `waitForChecks`).
 * - `respond-to-ci`       — every check is complete AND at least one failed.
 *                           Closes the gap where GitHub fires the success
 *                           event last after a fast-failing sibling suite,
 *                           and no later `conclusion=failure` event will fire
 *                           to wake `check-suite-failure`.
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

		// Mixed-state SHA fork: GitHub fires check_suite.completed once per
		// workflow. When workflow A's suite succeeds but workflow B's suite on
		// the same SHA failed earlier (and workflow B's failure handler skipped
		// with "not all complete yet"), this success event is the one that
		// closes the picture. If aggregate state has any failure, dispatch
		// respond-to-ci instead of review — otherwise respond-to-ci is lost
		// because no later check_suite event with conclusion=failure will fire.
		// See PR #176 / 2026-04-30 for the live incident.
		const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, headSha);
		const allComplete = checkStatus.checkRuns.every((cr) => cr.status === 'completed');
		const anyFailed = checkStatus.checkRuns.some(
			(cr) =>
				cr.conclusion === 'failure' ||
				cr.conclusion === 'timed_out' ||
				cr.conclusion === 'action_required',
		);
		if (allComplete && anyFailed) {
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
		// check_suite deliveries and other review-producing triggers.
		const dedupKey = buildReviewDispatchKey(owner, repo, prNumber, headSha);
		if (!claimReviewDispatch(dedupKey, this.name, { prNumber, headSha })) {
			return skip(
				this.name,
				`Review dispatch for PR #${prNumber}@${headSha} already claimed by another path (dedup)`,
			);
		}

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
			waitForChecks: true,
			onBlocked: () => releaseReviewDispatch(dedupKey),
		};
	}
}

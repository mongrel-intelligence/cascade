import { type CheckSuiteStatus, githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { gateAttemptLimit } from '../shared/gates.js';
import { skip } from '../shared/skip.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import {
	buildRespondToCiDispatchKey,
	claimRespondToCiDispatch,
	releaseRespondToCiDispatch,
} from './respond-to-ci-dedup.js';
import { buildRespondToCiResult } from './result-builders.js';
import type { GitHubCheckSuitePayload } from './types.js';

// Per-PR fix-attempt counter shared across the failure handler and the
// success handler's mixed-state fork. The lifecycle is: increment on dispatch,
// reset via `resetFixAttempts` (called by tests only — pr-ready-to-merge does
// not auto-reset; the counter ages out with the in-process Map).
const fixAttempts = new Map<number, number>();
const MAX_ATTEMPTS = 3;

export function resetFixAttempts(prNumber: number): void {
	fixAttempts.delete(prNumber);
}

export interface PRDetails {
	headRef: string;
	htmlUrl: string;
	title: string;
}

/**
 * Build a respond-to-ci dispatch result, applying the trigger-enabled gate +
 * per-PR attempt limit. Both `check-suite-failure` (when the failure event
 * itself arrives last) and `check-suite-success` (when a success event closes
 * a mixed-state SHA — see #1241) call this so the dispatch contract is
 * single-sourced.
 *
 * Returns either a respond-to-ci `TriggerResult` ready to enqueue, `null`
 * when the trigger is disabled at config (so the registry's first-match loop
 * can continue to the next matcher), or a structured skip when the attempt
 * limit is hit.
 */
export async function dispatchRespondToCi(opts: {
	ctx: TriggerContext;
	prNumber: number;
	prDetails: PRDetails;
	payload: GitHubCheckSuitePayload;
	workItemId: string | undefined;
	workItemUrl: string | undefined;
	workItemTitle: string | undefined;
	checkStatus: CheckSuiteStatus;
	handlerName: string;
}): Promise<TriggerResult | null> {
	if (
		!(await checkTriggerEnabled(
			opts.ctx.project.id,
			'respond-to-ci',
			'scm:check-suite-failure',
			opts.handlerName,
		))
	) {
		return null;
	}

	const { owner, repo } = parseRepoFullName(opts.payload.repository.full_name);
	const headSha = opts.payload.check_suite.head_sha;

	// Cross-process dedup: the success handler's 30 s deferred recheck fires
	// in a fresh worker container with an empty in-process Map — it has no
	// memory of what the router dispatched earlier.  Claim the Redis slot here;
	// the recheck finds it taken and skips, preventing duplicate fix agents for
	// the same PR+SHA.  Mirrors the review-dispatch-dedup pattern.
	const dedupKey = buildRespondToCiDispatchKey(owner, repo, opts.prNumber, headSha);
	const claimed = await claimRespondToCiDispatch(dedupKey, opts.handlerName, {
		prNumber: opts.prNumber,
		headSha,
	});
	if (!claimed) {
		return skip(
			opts.handlerName,
			`Respond-to-ci already dispatched for PR #${opts.prNumber}@${headSha} (dedup)`,
		);
	}

	const attempts = fixAttempts.get(opts.prNumber) ?? 0;
	const limitSkip = gateAttemptLimit(attempts, MAX_ATTEMPTS, opts.prNumber, opts.handlerName);
	if (limitSkip) {
		await githubClient.createPRComment(
			owner,
			repo,
			opts.prNumber,
			'⚠️ Unable to automatically fix failing checks after 3 attempts. Manual intervention required.',
		);
		return limitSkip;
	}

	fixAttempts.set(opts.prNumber, attempts + 1);

	logger.info('Check suite failure on implementer PR — dispatching respond-to-ci', {
		handler: opts.handlerName,
		prNumber: opts.prNumber,
		workItemId: opts.workItemId,
		attempt: attempts + 1,
		totalChecks: opts.checkStatus.totalCount,
		failedChecks: opts.checkStatus.checkRuns
			.filter(
				(cr) =>
					cr.conclusion === 'failure' ||
					cr.conclusion === 'timed_out' ||
					cr.conclusion === 'action_required',
			)
			.map((cr) => cr.name),
	});

	return {
		...buildRespondToCiResult({
			prNumber: opts.prNumber,
			prDetails: opts.prDetails,
			repoFullName: opts.payload.repository.full_name,
			headSha,
			workItemId: opts.workItemId,
			workItemUrl: opts.workItemUrl,
			workItemTitle: opts.workItemTitle,
		}),
		onBlocked: () => {
			// Fire-and-forget — release is best-effort, TTL is the safety net.
			void releaseRespondToCiDispatch(dedupKey);
		},
	};
}

import { type CheckSuiteStatus, githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { gateAttemptLimit, gateTriggerEnabled } from '../shared/gates.js';
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
 * Returns either a respond-to-ci `TriggerResult` ready to enqueue, or a
 * structured skip when the trigger is disabled or the attempt limit is hit.
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
}): Promise<TriggerResult> {
	const enabled = await gateTriggerEnabled(
		opts.ctx.project.id,
		'respond-to-ci',
		'scm:check-suite-failure',
		opts.handlerName,
	);
	if (enabled) return enabled;

	const attempts = fixAttempts.get(opts.prNumber) ?? 0;
	const limitSkip = gateAttemptLimit(attempts, MAX_ATTEMPTS, opts.prNumber, opts.handlerName);
	if (limitSkip) {
		const { owner, repo } = parseRepoFullName(opts.payload.repository.full_name);
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
			headSha: opts.payload.check_suite.head_sha,
			workItemId: opts.workItemId,
			workItemUrl: opts.workItemUrl,
			workItemTitle: opts.workItemTitle,
		}),
	};
}

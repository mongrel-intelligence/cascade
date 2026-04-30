import { githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import {
	gateBaseBranch,
	gateCascadePersona,
	gateTriggerEnabled,
	requirePersonaIdentities,
} from '../shared/gates.js';
import { skip } from '../shared/skip.js';
import { dispatchRespondToCi, resetFixAttempts } from './respond-to-ci-dispatch.js';
import { type GitHubCheckSuitePayload, isGitHubCheckSuitePayload } from './types.js';
import { parsePrNumberFromRef, resolveWorkItemDisplayData, resolveWorkItemId } from './utils.js';

export { resetFixAttempts };

/**
 * Resolve a PR number from a check_suite payload.
 * Tries pull_requests[], then refs/pull/{N}/head parsing, then a GitHub API lookup by branch.
 */
async function resolvePrNumber(
	owner: string,
	repo: string,
	pullRequests: Array<{ number: number }>,
	headBranch: string | null | undefined,
	handlerName: string,
): Promise<number | null> {
	if (pullRequests.length > 0) return pullRequests[0].number;

	const parsed = parsePrNumberFromRef(headBranch);
	if (parsed !== null) return parsed;

	// GitHub omits pull_requests for some check suites (e.g. CodeQL).
	// Fall back to looking up the open PR by branch name.
	if (!headBranch) {
		logger.info('No pull_requests and no head_branch in payload, skipping', {
			handler: handlerName,
		});
		return null;
	}
	const pr = await githubClient.getOpenPRByBranch(owner, repo, headBranch);
	if (!pr) {
		logger.info('No open PR found for head branch, skipping', { handler: handlerName, headBranch });
		return null;
	}
	return pr.number;
}

export class CheckSuiteFailureTrigger implements TriggerHandler {
	name = 'check-suite-failure';
	description =
		'Triggers respond-to-ci agent when check suite fails on a PR by the implementer persona';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubCheckSuitePayload(ctx.payload)) return false;

		const payload = ctx.payload;

		// Only trigger on completed check suites with failure conclusion
		if (payload.action !== 'completed') return false;
		if (payload.check_suite.conclusion !== 'failure') return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Early-exit on disabled trigger to avoid GitHub API calls when not needed.
		// `dispatchRespondToCi` re-checks the same gate (it's the single source of
		// truth for the success-handler's mixed-state fork too); the redundant call
		// here is one DB lookup, which the trigger-enabled cache absorbs.
		const enabled = await gateTriggerEnabled(
			ctx.project.id,
			'respond-to-ci',
			'scm:check-suite-failure',
			this.name,
		);
		if (enabled) return enabled;

		const payload = ctx.payload as GitHubCheckSuitePayload;
		const { owner, repo } = parseRepoFullName(payload.repository.full_name);

		// Resolve PR number — from payload, refs/pull/{N}/head, or branch name lookup
		const prNumber = await resolvePrNumber(
			owner,
			repo,
			payload.check_suite.pull_requests,
			payload.check_suite.head_branch,
			this.name,
		);
		if (prNumber === null) {
			return skip(this.name, 'Could not resolve PR number from check_suite payload');
		}
		const headSha = payload.check_suite.head_sha;

		// Fetch PR details
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		// Sync gate chain — author must be a cascade persona (implementer OR
		// reviewer; loop-prevention) AND the PR must target the project's base
		// branch. Both gates short-circuit on the first failure.
		const personasResult = requirePersonaIdentities(ctx.personaIdentities, prNumber, this.name);
		if (!personasResult.ok) return personasResult.skip;

		const gateChainSkip =
			gateCascadePersona(prDetails.user.login, prNumber, personasResult.value, this.name) ??
			gateBaseBranch(prDetails.baseRef, prNumber, ctx.project, this.name);
		if (gateChainSkip) return gateChainSkip;

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber);
		const { workItemUrl, workItemTitle } = await resolveWorkItemDisplayData(workItemId);

		// Get ALL check runs for this commit to verify they're all complete
		const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, headSha);

		// Verify ALL checks have completed (not still running)
		const allComplete = checkStatus.checkRuns.every((cr) => cr.status === 'completed');
		if (!allComplete) {
			const incomplete = checkStatus.checkRuns
				.filter((cr) => cr.status !== 'completed')
				.map((cr) => cr.name);
			logger.info('Not all checks complete yet, waiting', {
				prNumber,
				totalChecks: checkStatus.totalCount,
				incompleteChecks: incomplete,
			});
			return skip(
				this.name,
				`Not all checks complete yet (${incomplete.length}/${checkStatus.totalCount} still running): ${incomplete.join(', ')}`,
			);
		}

		// Verify at least one check failed
		const anyFailed = checkStatus.checkRuns.some(
			(cr) =>
				cr.conclusion === 'failure' ||
				cr.conclusion === 'timed_out' ||
				cr.conclusion === 'action_required',
		);

		if (!anyFailed) {
			logger.info('All checks passed, no action needed', {
				prNumber,
				totalChecks: checkStatus.totalCount,
			});
			return skip(
				this.name,
				`All ${checkStatus.totalCount} checks passed for PR #${prNumber} — no action needed`,
			);
		}

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
}

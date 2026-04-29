import { githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import {
	gateAttemptLimit,
	gateBaseBranch,
	gateCascadePersona,
	gateTriggerEnabled,
	requirePersonaIdentities,
} from '../shared/gates.js';
import { skip } from '../shared/skip.js';
import { type GitHubCheckSuitePayload, isGitHubCheckSuitePayload } from './types.js';
import { parsePrNumberFromRef, resolveWorkItemDisplayData, resolveWorkItemId } from './utils.js';

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

// Track fix attempts per PR to prevent infinite loops
const fixAttempts = new Map<number, number>();
const MAX_ATTEMPTS = 3;

// Export for cleanup by PRReadyToMergeTrigger
export function resetFixAttempts(prNumber: number): void {
	fixAttempts.delete(prNumber);
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

		// Check attempt limit to prevent infinite loops. Side effect (PR
		// comment) is handler-local because the warning text is contractual,
		// not part of the gate's pure logic.
		const attempts = fixAttempts.get(prNumber) || 0;
		const limitSkip = gateAttemptLimit(attempts, MAX_ATTEMPTS, prNumber, this.name);
		if (limitSkip) {
			await githubClient.createPRComment(
				owner,
				repo,
				prNumber,
				'⚠️ Unable to automatically fix failing checks after 3 attempts. Manual intervention required.',
			);
			return limitSkip;
		}

		// Increment attempt counter
		fixAttempts.set(prNumber, attempts + 1);

		logger.info('Check suite failure on implementer PR - all checks complete', {
			prNumber,
			workItemId,
			attempt: attempts + 1,
			totalChecks: checkStatus.totalCount,
			failedChecks: checkStatus.checkRuns
				.filter(
					(cr) =>
						cr.conclusion === 'failure' ||
						cr.conclusion === 'timed_out' ||
						cr.conclusion === 'action_required',
				)
				.map((cr) => cr.name),
		});

		const prBranch = prDetails.headRef;

		return {
			agentType: 'respond-to-ci',
			agentInput: {
				prNumber,
				prBranch,
				repoFullName: payload.repository.full_name,
				headSha,
				triggerType: 'check-failure',
				triggerEvent: 'scm:check-suite-failure',
				workItemId: workItemId,
			},
			prNumber,
			prUrl: prDetails.htmlUrl,
			prTitle: prDetails.title,
			workItemId,
			workItemUrl,
			workItemTitle,
		};
	}
}

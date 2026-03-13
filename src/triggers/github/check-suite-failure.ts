import { githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { type GitHubCheckSuitePayload, isGitHubCheckSuitePayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

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

		// Must have at least one associated PR
		if (payload.check_suite.pull_requests.length === 0) return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check trigger config via new DB-driven system
		if (
			!(await checkTriggerEnabled(
				ctx.project.id,
				'respond-to-ci',
				'scm:check-suite-failure',
				this.name,
			))
		) {
			return null;
		}

		const payload = ctx.payload as GitHubCheckSuitePayload;
		const { owner, repo } = parseRepoFullName(payload.repository.full_name);

		// Get the first associated PR (usually there's only one)
		const prRef = payload.check_suite.pull_requests[0];
		const prNumber = prRef.number;
		const headSha = payload.check_suite.head_sha;

		// Fetch PR details
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		// Gate on PR author being the implementer persona
		if (!ctx.personaIdentities) {
			logger.info('No persona identities available, skipping', { handler: this.name, prNumber });
			return null;
		}
		const implLogin = ctx.personaIdentities.implementer;
		if (prDetails.user.login !== implLogin && prDetails.user.login !== `${implLogin}[bot]`) {
			logger.info('PR not authored by implementer persona, skipping check failure trigger', {
				prNumber,
				prAuthor: prDetails.user.login,
			});
			return null;
		}

		// Only trigger for PRs targeting the project's base branch
		if (prDetails.baseRef !== ctx.project.baseBranch) {
			logger.info('PR targets non-base branch, skipping check failure trigger', {
				prNumber,
				baseRef: prDetails.baseRef,
				projectBaseBranch: ctx.project.baseBranch,
			});
			return null;
		}

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber);

		// Get ALL check runs for this commit to verify they're all complete
		const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, headSha);

		// Verify ALL checks have completed (not still running)
		const allComplete = checkStatus.checkRuns.every((cr) => cr.status === 'completed');
		if (!allComplete) {
			logger.info('Not all checks complete yet, waiting', {
				prNumber,
				totalChecks: checkStatus.totalCount,
				incompleteChecks: checkStatus.checkRuns
					.filter((cr) => cr.status !== 'completed')
					.map((cr) => cr.name),
			});
			return null;
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
			return null;
		}

		// Check attempt limit to prevent infinite loops
		const attempts = fixAttempts.get(prNumber) || 0;
		if (attempts >= MAX_ATTEMPTS) {
			logger.warn('Max auto-fix attempts reached for PR', {
				prNumber,
				attempts,
			});
			await githubClient.createPRComment(
				owner,
				repo,
				prNumber,
				'⚠️ Unable to automatically fix failing checks after 3 attempts. Manual intervention required.',
			);
			return null;
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

		return {
			agentType: 'respond-to-ci',
			agentInput: {
				prNumber,
				prBranch: prRef.head.ref,
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
		};
	}
}

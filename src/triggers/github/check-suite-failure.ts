import { githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { type GitHubCheckSuitePayload, isGitHubCheckSuitePayload } from './types.js';
import { extractTrelloCardId, hasTrelloCardUrl } from './utils.js';

// Track fix attempts per PR to prevent infinite loops
const fixAttempts = new Map<number, number>();
const MAX_ATTEMPTS = 3;

// Export for cleanup by PRReadyToMergeTrigger
export function resetFixAttempts(prNumber: number): void {
	fixAttempts.delete(prNumber);
}

export class CheckSuiteFailureTrigger implements TriggerHandler {
	name = 'check-suite-failure';
	description = 'Triggers review agent when check suite fails on a PR with Trello card';

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
		const payload = ctx.payload as GitHubCheckSuitePayload;
		const [owner, repo] = payload.repository.full_name.split('/');

		// Get the first associated PR (usually there's only one)
		const prRef = payload.check_suite.pull_requests[0];
		const prNumber = prRef.number;
		const headSha = payload.check_suite.head_sha;

		// Fetch PR to check for Trello card URL
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		if (!hasTrelloCardUrl(prDetails.body)) {
			logger.info('PR does not have Trello card URL, skipping check failure trigger', {
				prNumber,
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

		const cardId = extractTrelloCardId(prDetails.body);

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

		logger.info('Check suite failure on PR with Trello card - all checks complete', {
			prNumber,
			cardId,
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
				cardId: cardId || undefined,
			},
			prNumber,
			cardId: cardId || undefined,
		};
	}
}

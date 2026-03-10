import { githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { type GitHubPullRequestPayload, isGitHubPullRequestPayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

// Track conflict resolution attempts per PR to prevent infinite loops
const conflictAttempts = new Map<number, number>();
const MAX_ATTEMPTS = 2;
const MERGEABLE_RETRY_COUNT = 2;
const MERGEABLE_RETRY_DELAY_MS = 2000;

// Export for cleanup when conflicts are resolved
export function resetConflictAttempts(prNumber: number): void {
	conflictAttempts.delete(prNumber);
}

export class PRConflictDetectedTrigger implements TriggerHandler {
	name = 'pr-conflict-detected';
	description =
		'Triggers resolve-conflicts agent when a PR becomes unmergeable due to merge conflicts';

	matches(ctx: TriggerContext): boolean {
		if (ctx.source !== 'github') return false;
		if (!isGitHubPullRequestPayload(ctx.payload)) return false;

		const payload = ctx.payload;

		// Only trigger on synchronize events (when PR head is pushed/updated)
		if (payload.action !== 'synchronize') return false;

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Check trigger config via DB-driven system
		if (
			!(await checkTriggerEnabled(
				ctx.project.id,
				'resolve-conflicts',
				'scm:conflict-resolution',
				this.name,
			))
		) {
			return null;
		}

		const payload = ctx.payload as GitHubPullRequestPayload;
		const prNumber = payload.pull_request.number;
		const repoFullName = payload.repository.full_name;
		const { owner, repo } = parseRepoFullName(repoFullName);

		// Gate on PR author being the implementer persona
		if (!ctx.personaIdentities) {
			logger.info('No persona identities available, skipping', {
				handler: this.name,
				prNumber,
			});
			return null;
		}
		const implLogin = ctx.personaIdentities.implementer;
		const prAuthorLogin = payload.pull_request.user.login;
		if (prAuthorLogin !== implLogin && prAuthorLogin !== `${implLogin}[bot]`) {
			logger.info('PR not authored by implementer persona, skipping conflict detection trigger', {
				prNumber,
				prAuthor: prAuthorLogin,
			});
			return null;
		}

		// Only trigger for PRs targeting the project's base branch
		if (payload.pull_request.base.ref !== ctx.project.baseBranch) {
			logger.info('PR targets non-base branch, skipping conflict detection trigger', {
				prNumber,
				baseRef: payload.pull_request.base.ref,
				projectBaseBranch: ctx.project.baseBranch,
			});
			return null;
		}

		// Fetch PR details, retrying if mergeable is null (GitHub computes it asynchronously)
		let prDetails = await githubClient.getPR(owner, repo, prNumber);

		if (prDetails.mergeable === null) {
			for (let attempt = 0; attempt < MERGEABLE_RETRY_COUNT; attempt++) {
				logger.info('mergeable is null, retrying after delay', {
					prNumber,
					attempt: attempt + 1,
					delayMs: MERGEABLE_RETRY_DELAY_MS,
				});
				await new Promise((resolve) => setTimeout(resolve, MERGEABLE_RETRY_DELAY_MS));
				prDetails = await githubClient.getPR(owner, repo, prNumber);
				if (prDetails.mergeable !== null) break;
			}
		}

		// If still null after retries, skip — we can't determine mergeability
		if (prDetails.mergeable === null) {
			logger.info('mergeable still null after retries, skipping conflict detection trigger', {
				prNumber,
			});
			return null;
		}

		// Only fire if PR is unmergeable (has conflicts)
		if (prDetails.mergeable !== false) {
			logger.debug('PR is mergeable, no conflict detected', { prNumber });
			return null;
		}

		// Check attempt limit to prevent infinite loops
		const attempts = conflictAttempts.get(prNumber) || 0;
		if (attempts >= MAX_ATTEMPTS) {
			logger.warn('Max conflict resolution attempts reached for PR', {
				prNumber,
				attempts,
			});
			await githubClient.createPRComment(
				owner,
				repo,
				prNumber,
				'⚠️ Unable to automatically resolve merge conflicts after 2 attempts. Manual intervention required.',
			);
			return null;
		}

		// Increment attempt counter
		conflictAttempts.set(prNumber, attempts + 1);

		// Resolve work item from DB (with PR body fallback)
		const workItemId = await resolveWorkItemId(
			ctx.project.id,
			prNumber,
			prDetails.body,
			ctx.project,
		);

		logger.info('PR has merge conflicts — triggering resolve-conflicts agent', {
			prNumber,
			workItemId,
			attempt: attempts + 1,
		});

		return {
			agentType: 'resolve-conflicts',
			agentInput: {
				prNumber,
				prBranch: payload.pull_request.head.ref,
				repoFullName,
				headSha: payload.pull_request.head.sha,
				triggerType: 'conflict-resolution',
				triggerEvent: 'scm:pr-conflict-detected',
				cardId: workItemId,
			},
			prNumber,
			workItemId,
		};
	}
}

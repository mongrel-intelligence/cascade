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
		const enabled = await gateTriggerEnabled(
			ctx.project.id,
			'resolve-conflicts',
			'scm:pr-conflict-detected',
			this.name,
		);
		if (enabled) return enabled;

		const payload = ctx.payload as GitHubPullRequestPayload;
		const prNumber = payload.pull_request.number;
		const repoFullName = payload.repository.full_name;
		const { owner, repo } = parseRepoFullName(repoFullName);

		// Sync gate chain — author must be a cascade persona AND the PR must
		// target the project's base branch. Loop-prevention: only auto-resolve
		// conflicts on PRs authored by bot personas; human PRs are owned by
		// the human.
		const personasResult = requirePersonaIdentities(ctx.personaIdentities, prNumber, this.name);
		if (!personasResult.ok) return personasResult.skip;

		const prAuthorLogin = payload.pull_request.user.login;
		const gateChainSkip =
			gateCascadePersona(prAuthorLogin, prNumber, personasResult.value, this.name) ??
			gateBaseBranch(payload.pull_request.base.ref, prNumber, ctx.project, this.name);
		if (gateChainSkip) return gateChainSkip;

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
			return skip(
				this.name,
				`mergeable still null after ${MERGEABLE_RETRY_COUNT} retries for PR #${prNumber} — cannot determine mergeability`,
			);
		}

		// Only fire if PR is unmergeable (has conflicts)
		if (prDetails.mergeable !== false) {
			logger.debug('PR is mergeable, no conflict detected', { prNumber });
			return skip(this.name, `PR #${prNumber} is mergeable — no conflict detected`);
		}

		// Check attempt limit to prevent infinite loops. Side effect (PR
		// comment) is handler-local because the warning text differs from
		// other handlers and is part of the contract.
		const attempts = conflictAttempts.get(prNumber) || 0;
		const limitSkip = gateAttemptLimit(attempts, MAX_ATTEMPTS, prNumber, this.name);
		if (limitSkip) {
			await githubClient.createPRComment(
				owner,
				repo,
				prNumber,
				'⚠️ Unable to automatically resolve merge conflicts after 2 attempts. Manual intervention required.',
			);
			return limitSkip;
		}

		// Increment attempt counter
		conflictAttempts.set(prNumber, attempts + 1);

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber);

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
				workItemId: workItemId,
			},
			prNumber,
			prUrl: prDetails.htmlUrl,
			prTitle: prDetails.title,
			workItemId,
		};
	}
}

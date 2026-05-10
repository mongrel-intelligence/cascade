import { githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import {
	gateAttemptLimit,
	gateBaseBranch,
	gateCascadePersona,
	requirePersonaIdentities,
} from '../shared/gates.js';
import { buildDeferredRecheckResult } from '../shared/result-builders.js';
import { skip } from '../shared/skip.js';
import { checkTriggerEnabled } from '../shared/trigger-check.js';
import { buildResolveConflictsResult } from './result-builders.js';
import { type GitHubPullRequestPayload, isGitHubPullRequestPayload } from './types.js';
import { resolveWorkItemId } from './utils.js';

// Track conflict resolution attempts per PR to prevent infinite loops
const conflictAttempts = new Map<number, number>();
const MAX_ATTEMPTS = 2;
const MERGEABLE_RETRY_COUNT = 2;
const MERGEABLE_RETRY_DELAY_MS = 2000;
const MERGEABILITY_RECHECK_DELAY_MS = 45_000;

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

		// Trigger on `opened`, `reopened`, and `synchronize` — the three
		// actions that produce a candidate head SHA whose mergeability we
		// should check:
		//   - opened: brand-new PR. Bit us on ucho/PR #226 (2026-05-02) —
		//     the impl bot opened the PR already CONFLICTING against `dev`,
		//     and because the matcher previously accepted only `synchronize`,
		//     `resolve-conflicts` never fired until someone pushed a commit.
		//   - reopened: closed PR brought back; mergeability may have flipped
		//     against the now-advanced base.
		//   - synchronize: new commit pushed to existing PR (the original
		//     intent of this trigger).
		// `closed`, `edited`, `labeled`, etc. correctly stay rejected.
		// The handler's `mergeable === null` retry loop covers GitHub's async
		// mergeability computation that's most prominent on `opened`.
		if (
			payload.action !== 'opened' &&
			payload.action !== 'reopened' &&
			payload.action !== 'synchronize'
		) {
			return false;
		}

		return true;
	}

	async handle(ctx: TriggerContext): Promise<TriggerResult | null> {
		// Disabled-at-config returns null so the registry's first-match loop
		// continues to the next matcher — see `src/triggers/shared/trigger-check.ts`
		// for the disabled-shadowing contract.
		if (
			!(await checkTriggerEnabled(
				ctx.project.id,
				'resolve-conflicts',
				'scm:pr-conflict-detected',
				this.name,
			))
		) {
			return null;
		}

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

		// If still null after retries, schedule a deferred re-check ~45s later
		if (prDetails.mergeable === null) {
			const coalesceKey = `${ctx.project.id}:pr-conflict-recheck:${prNumber}`;
			logger.info('mergeable still null after retries, scheduling deferred re-check', {
				prNumber,
				coalesceKey,
				delayMs: MERGEABILITY_RECHECK_DELAY_MS,
			});
			return buildDeferredRecheckResult({
				delayMs: MERGEABILITY_RECHECK_DELAY_MS,
				coalesceKey,
			});
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

		return buildResolveConflictsResult({
			prNumber,
			prDetails: {
				headRef: payload.pull_request.head.ref,
				htmlUrl: prDetails.htmlUrl,
				title: prDetails.title,
			},
			repoFullName,
			headSha: payload.pull_request.head.sha,
			workItemId,
		});
	}
}

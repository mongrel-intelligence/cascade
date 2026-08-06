import { githubClient } from '../../github/client.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { buildDeferredRecheckResult } from '../shared/result-builders.js';
import { skip } from '../shared/skip.js';
import { checkTriggerEnabledWithParams } from '../shared/trigger-check.js';
import { decideCheckSuiteGates, decideCheckSuiteOutcome } from './check-suite-decision.js';
import { resolveCheckSuitePRNumber } from './pr-resolution.js';
import { dispatchRespondToCi, resetFixAttempts } from './respond-to-ci-dispatch.js';
import { type GitHubCheckSuitePayload, isGitHubCheckSuitePayload } from './types.js';
import { resolveWorkItemDisplayData, resolveWorkItemId } from './utils.js';

export { resetFixAttempts };

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
		// Disabled-at-config returns null so the registry's first-match loop
		// continues to the next matcher — see `src/triggers/shared/trigger-check.ts`
		// for the disabled-shadowing contract.
		// Check trigger config + get parameters (authorMode) in a single DB call.
		const triggerConfig = await checkTriggerEnabledWithParams(
			ctx.project.id,
			'respond-to-ci',
			'scm:check-suite-failure',
			this.name,
		);
		if (!triggerConfig.enabled) {
			return null;
		}

		const payload = ctx.payload as GitHubCheckSuitePayload;
		const { owner, repo } = parseRepoFullName(payload.repository.full_name);

		// Resolve PR number — from payload, refs/pull/{N}/head, or branch name lookup
		const prResolution = await resolveCheckSuitePRNumber({
			owner,
			repo,
			pullRequests: payload.check_suite.pull_requests,
			headBranch: payload.check_suite.head_branch,
			handlerName: this.name,
			lookupOpenPRByBranch: githubClient.getOpenPRByBranch,
		});
		if (!prResolution.ok) {
			return skip(this.name, 'Could not resolve PR number from check_suite payload');
		}
		const prNumber = prResolution.prNumber;
		const headSha = payload.check_suite.head_sha;

		// Fetch PR details
		const prDetails = await githubClient.getPR(owner, repo, prNumber);

		// Author-mode + base-branch gate BEFORE the checks API call (preserves
		// the pre-API skip; mirrors check-suite-success). Handles the missing-
		// personaIdentities case internally, so no separate requirePersonaIdentities
		// call is needed here. `own` (default) filters to cascade-authored PRs;
		// `external`/`all` now dispatch respond-to-ci on human same-repo PRs.
		const mode = { kind: 'respond-to-ci', parameters: triggerConfig.parameters } as const;
		const gateSkip = decideCheckSuiteGates({
			prNumber,
			prAuthorLogin: prDetails.user.login,
			prBaseRef: prDetails.baseRef,
			project: ctx.project,
			personaIdentities: ctx.personaIdentities,
			handlerName: this.name,
			mode,
		});
		if (gateSkip) {
			return skip(this.name, gateSkip.message);
		}

		// Resolve work item from DB
		const workItemId = await resolveWorkItemId(ctx.project.id, prNumber);
		const { workItemUrl, workItemTitle } = await resolveWorkItemDisplayData(workItemId);

		const checkStatus = await githubClient.getCheckSuiteStatus(owner, repo, headSha);
		const decision = decideCheckSuiteOutcome({
			checkStatus,
			prNumber,
			prAuthorLogin: prDetails.user.login,
			prBaseRef: prDetails.baseRef,
			project: ctx.project,
			personaIdentities: ctx.personaIdentities,
			handlerName: this.name,
			mode,
		});

		if (decision.action === 'defer') {
			// Same API-lag fix applied to check-suite-success (Bug 1, 2026-05-11):
			// returning a plain skip() would rely on GitHub firing another
			// check_suite.completed event, but when Actions API lags webhook
			// delivery the API still shows a check as in_progress even after
			// GitHub has already fired its final event. Schedule a deferred
			// re-check so the trigger re-evaluates against fresh API state ~30s later.
			const coalesceKey = `check-suite-failure:${owner}/${repo}:pr-${prNumber}:${headSha}`;
			logger.info('Not all checks complete yet, scheduling deferred re-check', {
				handler: this.name,
				prNumber,
				totalChecks: checkStatus.totalCount,
				incompleteChecks: decision.incompleteChecks,
				coalesceKey,
				delayMs: 30_000,
			});
			return buildDeferredRecheckResult({
				delayMs: 30_000,
				coalesceKey,
				recheckKind: 'check-suite',
			});
		}
		if (decision.action === 'skip') {
			if (decision.message.startsWith('All ')) {
				logger.info('All checks passed, no action needed', {
					prNumber,
					totalChecks: checkStatus.totalCount,
				});
			}
			return skip(this.name, decision.message);
		}
		if (decision.action === 'review') {
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

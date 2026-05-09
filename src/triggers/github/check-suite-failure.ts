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
import { decideCheckSuiteOutcome } from './check-suite-decision.js';
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

		const personasResult = requirePersonaIdentities(ctx.personaIdentities, prNumber, this.name);
		if (!personasResult.ok) return personasResult.skip;

		const gateChainSkip =
			gateCascadePersona(prDetails.user.login, prNumber, personasResult.value, this.name) ??
			gateBaseBranch(prDetails.baseRef, prNumber, ctx.project, this.name);
		if (gateChainSkip) return gateChainSkip;

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
			mode: { kind: 'respond-to-ci' },
		});

		if (decision.action === 'defer') {
			logger.info('Not all checks complete yet, waiting', {
				prNumber,
				totalChecks: checkStatus.totalCount,
				incompleteChecks: decision.incompleteChecks,
			});
			return skip(this.name, decision.message);
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

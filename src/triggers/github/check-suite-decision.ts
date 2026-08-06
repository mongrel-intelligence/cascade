import type { CheckSuiteStatus } from '../../github/client.js';
import { isCascadeBot, type PersonaIdentities } from '../../github/personas.js';
import type { ProjectConfig } from '../../types/index.js';
import { evaluateAuthorMode } from '../shared/author-mode.js';

export type CheckSuiteDecision =
	| { action: 'defer'; incompleteChecks: string[]; message: string }
	| { action: 'respond-to-ci' }
	| { action: 'review' }
	| { action: 'skip'; message: string };

export type CheckSuiteDecisionMode =
	| { kind: 'review'; parameters: Record<string, unknown> }
	| { kind: 'respond-to-ci'; parameters: Record<string, unknown> };

export interface DecideCheckSuiteOutcomeOptions {
	prNumber: number;
	prAuthorLogin: string;
	prBaseRef: string;
	project: ProjectConfig;
	personaIdentities: PersonaIdentities | undefined;
	handlerName: string;
	mode: CheckSuiteDecisionMode;
}

export interface DecideCheckSuiteAggregateOptions extends DecideCheckSuiteOutcomeOptions {
	checkStatus: CheckSuiteStatus;
}

const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'action_required']);

/**
 * Thin wrapper over the shared `evaluateAuthorMode`, adapting its result into a
 * check-suite `skip` decision. Preserves the established skip-message text
 * (including the `isCascadePR=` suffix) so webhook decision reasons are stable.
 */
function authorModeDecision(
	prAuthorLogin: string,
	personaIdentities: PersonaIdentities | undefined,
	parameters: Record<string, unknown>,
	prNumber: number,
	handlerName: string,
): Extract<CheckSuiteDecision, { action: 'skip' }> | null {
	const result = evaluateAuthorMode(prAuthorLogin, personaIdentities, parameters, handlerName);
	if (!result) {
		return {
			action: 'skip',
			message: 'Cascade persona identities could not be resolved (token / GitHub API issue)',
		};
	}
	if (result.shouldTrigger) return null;
	return {
		action: 'skip',
		message: `PR #${prNumber} author ${prAuthorLogin} does not match configured authorMode '${result.authorMode}' (isCascadePR=${result.isCascadePR})`,
	};
}

export function decideCheckSuiteGates(
	options: DecideCheckSuiteOutcomeOptions,
): Extract<CheckSuiteDecision, { action: 'skip' }> | null {
	const { prNumber, prAuthorLogin, prBaseRef, project, personaIdentities, handlerName, mode } =
		options;

	// Both `review` and `respond-to-ci` modes now carry authorMode parameters
	// and route through the shared author-mode evaluator (MNG-1774).
	const authorSkip = authorModeDecision(
		prAuthorLogin,
		personaIdentities,
		mode.parameters,
		prNumber,
		handlerName,
	);
	if (authorSkip) return authorSkip;

	// Bug 2 (2026-05-11 prod incident on ucho PR #393, MNG-691):
	// the base-branch gate was rejecting stacked PRs (MNG-691 → MNG-690
	// feature branch) even though the PR was opened by the cascade
	// implementer persona. The gate exists to filter human-authored /
	// third-party-bot drive-bys against random branches in the repo; that
	// case is already covered by the upstream persona check. Cascade-
	// authored PRs targeting any base branch are legitimate work product.
	const authorIsCascade = personaIdentities
		? isCascadeBot(prAuthorLogin, personaIdentities)
		: false;
	if (!authorIsCascade && prBaseRef !== project.baseBranch) {
		return {
			action: 'skip',
			message: `PR #${prNumber} targets ${prBaseRef}, not project base branch ${project.baseBranch}`,
		};
	}

	return null;
}

export function decideCheckSuiteOutcome(
	options: DecideCheckSuiteAggregateOptions,
): CheckSuiteDecision {
	const { checkStatus, prNumber, mode } = options;

	const gateSkip = decideCheckSuiteGates(options);
	if (gateSkip) return gateSkip;

	const incompleteChecks = checkStatus.checkRuns
		.filter((cr) => cr.status !== 'completed')
		.map((cr) => cr.name);
	if (incompleteChecks.length > 0) {
		return {
			action: 'defer',
			incompleteChecks,
			message: `Not all checks complete yet (${incompleteChecks.length}/${checkStatus.totalCount} still running): ${incompleteChecks.join(', ')}`,
		};
	}

	const anyFailed = checkStatus.checkRuns.some(
		(cr) => cr.conclusion !== null && FAILURE_CONCLUSIONS.has(cr.conclusion),
	);
	if (anyFailed) {
		return { action: 'respond-to-ci' };
	}

	if (mode.kind === 'respond-to-ci') {
		return {
			action: 'skip',
			message: `All ${checkStatus.totalCount} checks passed for PR #${prNumber} — no action needed`,
		};
	}

	return { action: 'review' };
}

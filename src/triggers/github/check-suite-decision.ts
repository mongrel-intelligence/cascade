import type { CheckSuiteStatus } from '../../github/client.js';
import { isCascadeBot, type PersonaIdentities } from '../../github/personas.js';
import type { ProjectConfig } from '../../types/index.js';

export type CheckSuiteDecision =
	| { action: 'defer'; incompleteChecks: string[]; message: string }
	| { action: 'respond-to-ci' }
	| { action: 'review' }
	| { action: 'skip'; message: string };

export type CheckSuiteDecisionMode =
	| { kind: 'review'; parameters: Record<string, unknown> }
	| { kind: 'respond-to-ci' };

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
const VALID_AUTHOR_MODES = new Set(['own', 'external', 'all']);

function resolveAuthorMode(parameters: Record<string, unknown>): string {
	const rawMode = parameters.authorMode;
	return typeof rawMode === 'string' && VALID_AUTHOR_MODES.has(rawMode) ? rawMode : 'own';
}

function authorModeDecision(
	prAuthorLogin: string,
	personaIdentities: PersonaIdentities | undefined,
	parameters: Record<string, unknown>,
	prNumber: number,
): Extract<CheckSuiteDecision, { action: 'skip' }> | null {
	if (!personaIdentities) {
		return {
			action: 'skip',
			message: 'Cascade persona identities could not be resolved (token / GitHub API issue)',
		};
	}

	const authorMode = resolveAuthorMode(parameters);
	const isCascadePR = isCascadeBot(prAuthorLogin, personaIdentities);
	const shouldTrigger =
		authorMode === 'all' ||
		(authorMode === 'own' && isCascadePR) ||
		(authorMode === 'external' && !isCascadePR);

	if (shouldTrigger) return null;

	return {
		action: 'skip',
		message: `PR #${prNumber} author ${prAuthorLogin} does not match configured authorMode '${authorMode}' (isCascadePR=${isCascadePR})`,
	};
}

function cascadePersonaDecision(
	prAuthorLogin: string,
	personaIdentities: PersonaIdentities | undefined,
	prNumber: number,
): Extract<CheckSuiteDecision, { action: 'skip' }> | null {
	if (!personaIdentities) {
		return {
			action: 'skip',
			message: 'Cascade persona identities could not be resolved (token / GitHub API issue)',
		};
	}
	if (isCascadeBot(prAuthorLogin, personaIdentities)) return null;
	return {
		action: 'skip',
		message: `PR #${prNumber} not authored by a cascade persona (author: ${prAuthorLogin})`,
	};
}

export function decideCheckSuiteGates(
	options: DecideCheckSuiteOutcomeOptions,
): Extract<CheckSuiteDecision, { action: 'skip' }> | null {
	const { prNumber, prAuthorLogin, prBaseRef, project, personaIdentities, mode } = options;

	const authorSkip =
		mode.kind === 'review'
			? authorModeDecision(prAuthorLogin, personaIdentities, mode.parameters, prNumber)
			: cascadePersonaDecision(prAuthorLogin, personaIdentities, prNumber);
	if (authorSkip) return authorSkip;

	if (prBaseRef !== project.baseBranch) {
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

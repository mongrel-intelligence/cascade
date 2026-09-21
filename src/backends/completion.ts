import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import type { PushedChangesAlternative } from '../agents/definitions/schema.js';
import type { AgentEngineResult } from './types.js';

export const COMPLETION_ERROR_NO_PR =
	'Agent completed but no authoritative PR creation was recorded';
export const COMPLETION_ERROR_NO_REVIEW =
	'Agent completed but no authoritative PR review submission was recorded';
export const COMPLETION_ERROR_NO_PUSH =
	'Agent completed but no authoritative pushed changes were recorded';
export const COMPLETION_ERROR_NO_PM_WRITE =
	'Agent completed but no PM write (checklist creation) was recorded';

/** Kinds of PR response that count as a substantive reply: a new top-level comment or an inline review reply. */
export const PR_RESPONSE_KINDS = ['top-level', 'inline-reply'] as const;
export type PRResponseKind = (typeof PR_RESPONSE_KINDS)[number];
const DEFAULT_PR_RESPONSE_COMMAND = 'cascade-tools scm post-pr-comment';

export const REJECTION_NO_PUSH =
	'no pushed-changes sidecar (cascade-tools session finish never recorded a push)';
export const REJECTION_NO_RESPONSE =
	'no PR response recorded (post-pr-comment / reply-to-review-comment never succeeded)';
export const REJECTION_RESPONSE_MALFORMED =
	'PR response sidecar is malformed (missing url or unknown kind)';
export const REJECTION_TREE_DIRTY =
	'PR response recorded but the working tree has uncommitted changes';
export const REJECTION_REPO_STATE_UNAVAILABLE =
	'PR response recorded but repository state unavailable (repoDir/initialHeadSha missing or git failed)';

function rejectionHeadMoved(initialHeadSha: string, currentHeadSha: string): string {
	return `PR response recorded but HEAD moved from ${initialHeadSha} to ${currentHeadSha} without a recorded push`;
}

export interface CompletionRequirements {
	requiresPR?: boolean;
	requiresReview?: boolean;
	requiresPushedChanges?: boolean;
	/** Outcomes that satisfy `requiresPushedChanges` instead of a push (declared per profile). */
	pushedChangesAlternatives?: readonly PushedChangesAlternative[];
	requiresPMWrite?: boolean;
	prSidecarPath?: string;
	reviewSidecarPath?: string;
	pushedChangesSidecarPath?: string;
	prResponseSidecarPath?: string;
	pmWriteSidecarPath?: string;
	/** Repository the run works in; with `initialHeadSha`, enables repository-state evidence. */
	repoDir?: string;
	/** HEAD at run start; the comment-only outcome requires HEAD to still be here. */
	initialHeadSha?: string;
	maxContinuationTurns?: number;
}

export interface PRResponseEvidence {
	url: string;
	kind: PRResponseKind;
	command: string;
}

export interface RepoStateEvidence {
	clean: boolean;
	headSha: string;
	headUnchanged: boolean;
}

export interface CompletionEvidence {
	hasAuthoritativePR: boolean;
	prUrl?: string;
	prCommand?: string;
	hasAuthoritativeReview: boolean;
	reviewUrl?: string;
	reviewBody?: string;
	reviewEvent?: string;
	hasAuthoritativePushedChanges: boolean;
	pushedBranch?: string;
	pushedHeadSha?: string;
	pushedCommand?: string;
	ackCommentDeleted?: boolean;
	hasPMWrite: boolean;
	hasAuthoritativePRResponse: boolean;
	prResponse?: PRResponseEvidence;
	/** A PR-response sidecar exists but fails the contract — evidence of nothing. */
	prResponseSidecarMalformed: boolean;
	/** Present only when both `repoDir` and `initialHeadSha` were supplied and git answered. */
	repoState?: RepoStateEvidence;
}

function readJsonSidecar(path: string | undefined): Record<string, unknown> | undefined {
	if (!path || !existsSync(path)) return undefined;
	try {
		const raw = readFileSync(path, 'utf-8');
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function readStringProp(
	data: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = data?.[key];
	return typeof value === 'string' && value ? value : undefined;
}

function isPRResponseKind(value: string | undefined): value is PRResponseKind {
	return (PR_RESPONSE_KINDS as readonly string[]).includes(value ?? '');
}

function readPRResponseSidecar(path: string | undefined): {
	response?: PRResponseEvidence;
	malformed: boolean;
} {
	if (!path || !existsSync(path)) return { malformed: false };
	const data = readJsonSidecar(path);
	const url = readStringProp(data, 'url');
	const kind = readStringProp(data, 'kind');
	if (!url || !isPRResponseKind(kind)) return { malformed: true };
	return {
		response: { url, kind, command: readStringProp(data, 'source') ?? DEFAULT_PR_RESPONSE_COMMAND },
		malformed: false,
	};
}

export function readRepoState(
	repoDir: string,
	initialHeadSha: string,
): RepoStateEvidence | undefined {
	const gitOptions = {
		cwd: repoDir,
		encoding: 'utf-8' as const,
		stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'],
	};
	try {
		const status = execFileSync('git', ['status', '--porcelain'], gitOptions);
		const headSha = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim();
		return {
			clean: status.trim().length === 0,
			headSha,
			headUnchanged: headSha === initialHeadSha,
		};
	} catch {
		return undefined;
	}
}

export function readCompletionEvidence(requirements?: CompletionRequirements): CompletionEvidence {
	const prSidecar = readJsonSidecar(requirements?.prSidecarPath);
	const reviewSidecar = readJsonSidecar(requirements?.reviewSidecarPath);
	const pushedChangesSidecar = readJsonSidecar(requirements?.pushedChangesSidecarPath);
	const pmWriteSidecar = readJsonSidecar(requirements?.pmWriteSidecarPath);
	const prResponseSidecar = readPRResponseSidecar(requirements?.prResponseSidecarPath);

	const prUrl = readStringProp(prSidecar, 'prUrl');
	const prCommand = readStringProp(prSidecar, 'source') ?? 'cascade-tools scm create-pr';
	const reviewUrl = readStringProp(reviewSidecar, 'reviewUrl');
	const reviewBody = readStringProp(reviewSidecar, 'body');
	const reviewEvent = readStringProp(reviewSidecar, 'event');
	const pushedBranch = readStringProp(pushedChangesSidecar, 'branch');
	const pushedHeadSha = readStringProp(pushedChangesSidecar, 'headSha');
	const pushedCommand =
		readStringProp(pushedChangesSidecar, 'source') ?? 'cascade-tools session finish';
	const repoState =
		requirements?.repoDir && requirements.initialHeadSha
			? readRepoState(requirements.repoDir, requirements.initialHeadSha)
			: undefined;

	return {
		hasAuthoritativePR: Boolean(prUrl),
		prUrl,
		prCommand,
		hasAuthoritativeReview: Boolean(reviewUrl),
		reviewUrl,
		reviewBody,
		reviewEvent,
		hasAuthoritativePushedChanges: Boolean(pushedHeadSha),
		pushedBranch,
		pushedHeadSha,
		pushedCommand,
		ackCommentDeleted:
			typeof reviewSidecar?.ackCommentDeleted === 'boolean'
				? reviewSidecar.ackCommentDeleted
				: undefined,
		hasPMWrite: Boolean(pmWriteSidecar),
		hasAuthoritativePRResponse: Boolean(prResponseSidecar.response),
		prResponse: prResponseSidecar.response,
		prResponseSidecarMalformed: prResponseSidecar.malformed,
		repoState,
	};
}

export type PushedChangesOutcome = 'pushed-changes' | PushedChangesAlternative;

export interface OutcomeRejection {
	outcome: PushedChangesOutcome;
	reason: string;
}

export type PushedChangesEvaluation =
	| { satisfiedBy: PushedChangesOutcome }
	| { satisfiedBy: null; rejections: OutcomeRejection[] };

type OutcomeCheck = (
	requirements: CompletionRequirements,
	evidence: CompletionEvidence,
) => string | undefined;

function rejectPRResponse(
	requirements: CompletionRequirements,
	evidence: CompletionEvidence,
): string | undefined {
	if (evidence.prResponseSidecarMalformed) return REJECTION_RESPONSE_MALFORMED;
	if (!evidence.prResponse) return REJECTION_NO_RESPONSE;
	if (!evidence.repoState) return REJECTION_REPO_STATE_UNAVAILABLE;
	if (!evidence.repoState.clean) return REJECTION_TREE_DIRTY;
	if (!evidence.repoState.headUnchanged) {
		return rejectionHeadMoved(
			requirements.initialHeadSha ?? 'run start',
			evidence.repoState.headSha,
		);
	}
	return undefined;
}

/** One check per outcome, each returning the rejection reason or `undefined` when satisfied. */
const OUTCOME_CHECKS: Record<PushedChangesOutcome, OutcomeCheck> = {
	'pushed-changes': (_requirements, evidence) =>
		evidence.hasAuthoritativePushedChanges ? undefined : REJECTION_NO_PUSH,
	'pr-response': rejectPRResponse,
};

/**
 * Decide whether `requiresPushedChanges` is met. The push branch is checked first, then
 * each declared alternative in order; the first satisfied branch wins. When none is
 * satisfied every branch reports its reason, so operators can see why each was rejected.
 */
export function evaluatePushedChanges(
	requirements: CompletionRequirements | undefined,
	evidence: CompletionEvidence,
): PushedChangesEvaluation | undefined {
	if (!requirements?.requiresPushedChanges) return undefined;
	const outcomes: PushedChangesOutcome[] = [
		'pushed-changes',
		...(requirements.pushedChangesAlternatives ?? []),
	];
	const rejections: OutcomeRejection[] = [];
	for (const outcome of outcomes) {
		const reason = OUTCOME_CHECKS[outcome](requirements, evidence);
		if (!reason) return { satisfiedBy: outcome };
		rejections.push({ outcome, reason });
	}
	return { satisfiedBy: null, rejections };
}

export const COMPLETION_ERROR_NO_PUSH_OR_RESPONSE =
	'Agent completed but neither authoritative pushed changes nor a substantive PR response with an unchanged repository were recorded';

export const CONTINUATION_PROMPT_NO_PUSH =
	'CASCADE completion check failed: no authoritative pushed changes were recorded for this task. Continue from the current session, commit and push the required changes, confirm the push succeeded, and only then finish.';

/**
 * Continuation guidance when a profile accepts a PR response instead of a push. A response
 * that is already recorded is named so the resumed session never posts it a second time.
 */
export function buildPushedChangesContinuationPrompt(
	rejections: OutcomeRejection[],
	evidence: CompletionEvidence,
): string {
	const reasons = rejections
		.map((rejection) => `${rejection.outcome}: ${rejection.reason}`)
		.join('; ');
	if (evidence.prResponse) {
		return (
			`CASCADE completion check failed: your PR response was already posted at ${evidence.prResponse.url} — do not post it again. ` +
			`It did not complete the run because: ${reasons}. Continue from the current session: either commit and push the intended changes and then run \`cascade-tools session finish\`, ` +
			'or revert the working tree to the run-start state if the reply was the whole answer, then finish.'
		);
	}
	return (
		`CASCADE completion check failed: neither a PR response nor pushed changes were recorded (${reasons}). ` +
		'If the comment asked a question, reply with `cascade-tools scm post-pr-comment` (or `cascade-tools scm reply-to-review-comment` for an inline thread) without changing the repository, then run `cascade-tools session finish`. ' +
		'If it asked for code changes, commit and push them, then finish.'
	);
}

export interface CompletionFailure {
	error: string;
	continuationPrompt: string;
	/** Why each pushed-changes outcome was rejected (present only for that requirement). */
	rejections?: OutcomeRejection[];
}

function pushedChangesFailure(
	requirements: CompletionRequirements,
	evidence: CompletionEvidence,
	rejections: OutcomeRejection[],
): CompletionFailure {
	if (!requirements.pushedChangesAlternatives?.length) {
		return {
			error: COMPLETION_ERROR_NO_PUSH,
			continuationPrompt: CONTINUATION_PROMPT_NO_PUSH,
			rejections,
		};
	}
	return {
		error: COMPLETION_ERROR_NO_PUSH_OR_RESPONSE,
		continuationPrompt: buildPushedChangesContinuationPrompt(rejections, evidence),
		rejections,
	};
}

export function getCompletionFailure(
	requirements: CompletionRequirements | undefined,
	evidence: CompletionEvidence,
): CompletionFailure | undefined {
	if (requirements?.requiresPR && !evidence.hasAuthoritativePR) {
		return {
			error: COMPLETION_ERROR_NO_PR,
			continuationPrompt:
				'CASCADE completion check failed: no authoritative PR creation was recorded for this task. Continue from the current session, create the PR using the required CASCADE tool flow, confirm the real PR URL from the successful tool result, and only then finish.',
		};
	}

	if (requirements?.requiresReview && !evidence.hasAuthoritativeReview) {
		return {
			error: COMPLETION_ERROR_NO_REVIEW,
			continuationPrompt:
				'CASCADE completion check failed: no authoritative PR review submission was recorded for this task. Continue from the current session, submit the review using the required CASCADE tool flow, confirm the review was submitted successfully, and only then finish.',
		};
	}

	const pushedChanges = requirements ? evaluatePushedChanges(requirements, evidence) : undefined;
	if (requirements && pushedChanges?.satisfiedBy === null) {
		return pushedChangesFailure(requirements, evidence, pushedChanges.rejections);
	}

	if (requirements?.requiresPMWrite && !evidence.hasPMWrite) {
		return {
			error: COMPLETION_ERROR_NO_PM_WRITE,
			continuationPrompt:
				'CASCADE completion check failed: no PM write was recorded. Create the implementation plan checklist using `cascade-tools pm add-checklist`, then finish.',
		};
	}

	return undefined;
}

/**
 * Read sidecar files and upgrade text-based PR evidence to authoritative.
 * Shared across Claude Code and OpenCode backends.
 */
export function applyCompletionEvidence(
	result: AgentEngineResult,
	completionRequirements: CompletionRequirements | undefined,
): AgentEngineResult {
	const evidence = readCompletionEvidence(completionRequirements);
	if (!evidence.prUrl) return result;
	return {
		...result,
		prUrl: evidence.prUrl,
		prEvidence: {
			source: 'native-tool-sidecar',
			authoritative: true,
			command: evidence.prCommand ?? 'cascade-tools scm create-pr',
		},
	};
}

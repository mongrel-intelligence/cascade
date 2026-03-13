import { existsSync, readFileSync } from 'node:fs';

export interface CompletionRequirements {
	requiresPR?: boolean;
	requiresReview?: boolean;
	requiresPushedChanges?: boolean;
	prSidecarPath?: string;
	reviewSidecarPath?: string;
	pushedChangesSidecarPath?: string;
	maxContinuationTurns?: number;
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

export function readCompletionEvidence(requirements?: CompletionRequirements): CompletionEvidence {
	const prSidecar = readJsonSidecar(requirements?.prSidecarPath);
	const reviewSidecar = readJsonSidecar(requirements?.reviewSidecarPath);
	const pushedChangesSidecar = readJsonSidecar(requirements?.pushedChangesSidecarPath);

	const prUrl = readStringProp(prSidecar, 'prUrl');
	const prCommand = readStringProp(prSidecar, 'source') ?? 'cascade-tools scm create-pr';
	const reviewUrl = readStringProp(reviewSidecar, 'reviewUrl');
	const reviewBody = readStringProp(reviewSidecar, 'body');
	const reviewEvent = readStringProp(reviewSidecar, 'event');
	const pushedBranch = readStringProp(pushedChangesSidecar, 'branch');
	const pushedHeadSha = readStringProp(pushedChangesSidecar, 'headSha');
	const pushedCommand =
		readStringProp(pushedChangesSidecar, 'source') ?? 'cascade-tools session finish';

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
	};
}

export interface CompletionFailure {
	error: string;
	continuationPrompt: string;
}

export function getCompletionFailure(
	requirements: CompletionRequirements | undefined,
	evidence: CompletionEvidence,
): CompletionFailure | undefined {
	if (requirements?.requiresPR && !evidence.hasAuthoritativePR) {
		return {
			error: 'Agent completed but no authoritative PR creation was recorded',
			continuationPrompt:
				'CASCADE completion check failed: no authoritative PR creation was recorded for this task. Continue from the current session, create the PR using the required CASCADE tool flow, confirm the real PR URL from the successful tool result, and only then finish.',
		};
	}

	if (requirements?.requiresReview && !evidence.hasAuthoritativeReview) {
		return {
			error: 'Agent completed but no authoritative PR review submission was recorded',
			continuationPrompt:
				'CASCADE completion check failed: no authoritative PR review submission was recorded for this task. Continue from the current session, submit the review using the required CASCADE tool flow, confirm the review was submitted successfully, and only then finish.',
		};
	}

	if (requirements?.requiresPushedChanges && !evidence.hasAuthoritativePushedChanges) {
		return {
			error: 'Agent completed but no authoritative pushed changes were recorded',
			continuationPrompt:
				'CASCADE completion check failed: no authoritative pushed changes were recorded for this task. Continue from the current session, commit and push the required changes, confirm the push succeeded, and only then finish.',
		};
	}

	return undefined;
}

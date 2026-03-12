import { existsSync, readFileSync } from 'node:fs';

export interface CompletionRequirements {
	requiresPR?: boolean;
	requiresReview?: boolean;
	requiresPushedChanges?: boolean;
	prSidecarPath?: string;
	reviewSidecarPath?: string;
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

export function readCompletionEvidence(requirements?: CompletionRequirements): CompletionEvidence {
	const prSidecar = readJsonSidecar(requirements?.prSidecarPath);
	const reviewSidecar = readJsonSidecar(requirements?.reviewSidecarPath);

	const prUrl =
		typeof prSidecar?.prUrl === 'string' && prSidecar.prUrl ? prSidecar.prUrl : undefined;
	const prCommand =
		typeof prSidecar?.source === 'string' && prSidecar.source
			? prSidecar.source
			: 'cascade-tools scm create-pr';
	const reviewUrl =
		typeof reviewSidecar?.reviewUrl === 'string' && reviewSidecar.reviewUrl
			? reviewSidecar.reviewUrl
			: undefined;
	const reviewBody =
		typeof reviewSidecar?.body === 'string' && reviewSidecar.body ? reviewSidecar.body : undefined;
	const reviewEvent =
		typeof reviewSidecar?.event === 'string' && reviewSidecar.event
			? reviewSidecar.event
			: undefined;

	return {
		hasAuthoritativePR: Boolean(prUrl),
		prUrl,
		prCommand,
		hasAuthoritativeReview: Boolean(reviewUrl),
		reviewUrl,
		reviewBody,
		reviewEvent,
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

	return undefined;
}

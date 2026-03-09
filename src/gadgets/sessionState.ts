import type { FinishHookFlags } from '../agents/definitions/schema.js';

export type SessionHooks = FinishHookFlags;

// Session-level state accessible to all gadgets
let sessionState = {
	agentType: null as string | null,
	baseBranch: 'main' as string,
	projectId: null as string | null,
	cardId: null as string | null,
	workItemUrl: null as string | null,
	workItemTitle: null as string | null,
	initialHeadSha: null as string | null,
	hooks: {} as SessionHooks,
	readOnlyFs: false,
	prCreated: false,
	prUrl: null as string | null,
	reviewSubmitted: false,
	reviewUrl: null as string | null,
	reviewBody: null as string | null,
	reviewEvent: null as string | null,
	initialCommentId: null as number | null,
};

export function initSessionState(
	agentType: string,
	baseBranch?: string,
	projectId?: string,
	cardId?: string,
	hooks?: SessionHooks,
	workItemUrl?: string,
	workItemTitle?: string,
	initialHeadSha?: string,
): void {
	sessionState = {
		agentType,
		baseBranch: baseBranch ?? 'main',
		projectId: projectId ?? null,
		cardId: cardId ?? null,
		workItemUrl: workItemUrl ?? null,
		workItemTitle: workItemTitle ?? null,
		initialHeadSha: initialHeadSha ?? null,
		hooks: hooks ?? {},
		readOnlyFs: false,
		prCreated: false,
		prUrl: null,
		reviewSubmitted: false,
		reviewUrl: null,
		reviewBody: null,
		reviewEvent: null,
		initialCommentId: null,
	};
}

export function getBaseBranch(): string {
	return sessionState.baseBranch;
}

export function getProjectId(): string | null {
	return sessionState.projectId;
}

export function getCardId(): string | null {
	return sessionState.cardId;
}

export function setReadOnlyFs(readOnly: boolean): void {
	sessionState.readOnlyFs = readOnly;
}

export function getWorkItemUrl(): string | null {
	return sessionState.workItemUrl;
}

export function getWorkItemTitle(): string | null {
	return sessionState.workItemTitle;
}

export function recordPRCreation(prUrl: string): void {
	sessionState.prCreated = true;
	sessionState.prUrl = prUrl;
}

export function recordReviewSubmission(
	reviewUrl: string,
	body?: string | null,
	event?: string | null,
): void {
	sessionState.reviewSubmitted = true;
	sessionState.reviewUrl = reviewUrl;
	sessionState.reviewBody = body ?? null;
	sessionState.reviewEvent = event ?? null;
}

export function recordInitialComment(commentId: number): void {
	sessionState.initialCommentId = commentId;
}

/**
 * Delete the initial ack comment from the PR and clear it from session state.
 *
 * Called by gadgets (e.g. CreatePRReview) immediately after a significant event
 * to clean up the stale ack/progress comment as soon as possible.
 * Wrapped in a try-catch so failures don't propagate to the caller.
 */
export async function deleteInitialComment(owner: string, repo: string): Promise<void> {
	const commentId = sessionState.initialCommentId;
	if (!commentId) return;

	// Clear state first so the post-agent callback sees null and short-circuits
	sessionState.initialCommentId = null;

	try {
		const { githubClient } = await import('../github/client.js');
		await githubClient.deletePRComment(owner, repo, commentId);
	} catch {
		// Best-effort: restore the id so post-agent callback can retry
		sessionState.initialCommentId = commentId;
	}
}

export function getSessionState() {
	return { ...sessionState };
}

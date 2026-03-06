/**
 * SCM hook flags resolved from the agent definition's hooks.scm configuration.
 * These drive finish validation logic.
 */
export interface SessionHooks {
	/** Whether the agent must create a PR before finishing */
	requiresPR?: boolean;
	/** Whether the agent must submit a review before finishing */
	requiresReview?: boolean;
	/** Whether the agent must have pushed changes before finishing */
	requiresPushedChanges?: boolean;
}

// Session-level state accessible to all gadgets
let sessionState = {
	agentType: null as string | null,
	baseBranch: 'main' as string,
	projectId: null as string | null,
	cardId: null as string | null,
	prCreated: false,
	prUrl: null as string | null,
	reviewSubmitted: false,
	reviewUrl: null as string | null,
	initialCommentId: null as number | null,
	hooks: {} as SessionHooks,
};

export function initSessionState(
	agentType: string,
	baseBranch?: string,
	projectId?: string,
	cardId?: string,
	hooks?: SessionHooks,
): void {
	sessionState = {
		agentType,
		baseBranch: baseBranch ?? 'main',
		projectId: projectId ?? null,
		cardId: cardId ?? null,
		prCreated: false,
		prUrl: null,
		reviewSubmitted: false,
		reviewUrl: null,
		initialCommentId: null,
		hooks: hooks ?? {},
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

export function recordPRCreation(prUrl: string): void {
	sessionState.prCreated = true;
	sessionState.prUrl = prUrl;
}

export function recordReviewSubmission(reviewUrl: string): void {
	sessionState.reviewSubmitted = true;
	sessionState.reviewUrl = reviewUrl;
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

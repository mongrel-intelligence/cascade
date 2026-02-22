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
};

export function initSessionState(
	agentType: string,
	baseBranch?: string,
	projectId?: string,
	cardId?: string,
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

export function getSessionState() {
	return { ...sessionState };
}

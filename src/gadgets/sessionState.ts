// Session-level state accessible to all gadgets
let sessionState = {
	agentType: null as string | null,
	prCreated: false,
	prUrl: null as string | null,
	reviewSubmitted: false,
	reviewUrl: null as string | null,
	initialCommentId: null as number | null,
};

export function initSessionState(agentType: string): void {
	sessionState = {
		agentType,
		prCreated: false,
		prUrl: null,
		reviewSubmitted: false,
		reviewUrl: null,
		initialCommentId: null,
	};
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

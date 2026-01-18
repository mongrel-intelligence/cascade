// Session-level state accessible to all gadgets
let sessionState = {
	agentType: null as string | null,
	prCreated: false,
	prUrl: null as string | null,
};

export function initSessionState(agentType: string): void {
	sessionState = { agentType, prCreated: false, prUrl: null };
}

export function recordPRCreation(prUrl: string): void {
	sessionState.prCreated = true;
	sessionState.prUrl = prUrl;
}

export function getSessionState() {
	return { ...sessionState };
}

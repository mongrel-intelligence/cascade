/**
 * Completed session notice - stored for injection into agent conversation.
 */
export interface CompletedSessionNotice {
	exitCode: number;
	tailOutput: string; // Last 100 lines
}

/**
 * Pending notices for sessions that completed.
 * Consumed by agent loop to inject as user messages.
 */
const pendingNotices = new Map<string, CompletedSessionNotice>();

/**
 * Add a pending notice for a completed session.
 */
export function addPendingNotice(session: string, notice: CompletedSessionNotice): void {
	pendingNotices.set(session, notice);
}

/**
 * Get and clear pending session completion notices.
 * Called by agent loop to inject into conversation via injectUserMessage().
 */
export function consumePendingSessionNotices(): Map<string, CompletedSessionNotice> {
	const notices = new Map(pendingNotices);
	pendingNotices.clear();
	return notices;
}

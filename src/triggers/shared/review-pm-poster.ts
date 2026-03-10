/**
 * Utility for posting a review summary to the PM work item (card/issue).
 *
 * Called after a successful review agent run when a PM work item is associated
 * with the PR being reviewed. This ensures the review content is also visible
 * in the PM tool, not only on GitHub.
 *
 * Best-effort: failures are silently swallowed via safeOperation so they
 * never block the review flow.
 */

import { getPMProviderOrNull } from '../../pm/index.js';
import { safeOperation } from '../../utils/safeOperation.js';

const MAX_BODY_LENGTH = 15_000; // Leave headroom below Trello's 16K limit
const TRUNCATION_NOTICE = '\n\n_[Review body truncated — view full review on GitHub]_';

/** Event-type emoji mapping for review headers */
const EVENT_EMOJI: Record<string, string> = {
	APPROVE: '✅',
	REQUEST_CHANGES: '🔄',
	COMMENT: '💬',
};

/**
 * Format a review for posting as a PM comment.
 *
 * @param body - The overall review summary text
 * @param event - The review event type (APPROVE, REQUEST_CHANGES, COMMENT)
 * @param url - The GitHub review URL
 * @returns Formatted markdown string
 */
export function formatReviewForPM(body: string, event: string, url: string): string {
	const emoji = EVENT_EMOJI[event] ?? '📝';
	const label = event.replace('_', ' ');

	let reviewBody = body;
	const header = `${emoji} **Code Review: ${label}**\n\n`;
	const footer = `\n\n[View review on GitHub](${url})`;

	const maxBodyLen = MAX_BODY_LENGTH - header.length - footer.length;
	if (reviewBody.length > maxBodyLen) {
		reviewBody = reviewBody.slice(0, maxBodyLen - TRUNCATION_NOTICE.length) + TRUNCATION_NOTICE;
	}

	return `${header}${reviewBody}${footer}`;
}

/**
 * Post the review summary to the PM work item as a comment.
 *
 * Guards:
 * - workItemId must be present
 * - sessionState must have a reviewBody (review was submitted this session)
 * - PM provider must be available in scope
 *
 * @param workItemId - The PM work item ID to post to
 * @param sessionState - Current session state snapshot
 * @param progressCommentId - Optional ID of an existing PM progress comment to update in-place.
 *   When provided, attempts to update the existing comment via `provider.updateComment`.
 *   Falls back to `provider.addComment` if the update fails (e.g. the comment was deleted).
 *   When not provided, always calls `provider.addComment` (backward-compatible behavior).
 */
export async function postReviewToPM(
	workItemId: string,
	sessionState: { reviewBody: string | null; reviewEvent: string | null; reviewUrl: string | null },
	progressCommentId?: string,
): Promise<void> {
	const { reviewBody, reviewEvent, reviewUrl } = sessionState;

	if (!reviewBody || !reviewUrl) return;

	const provider = getPMProviderOrNull();
	if (!provider) return;

	const event = reviewEvent ?? 'COMMENT';
	const formatted = formatReviewForPM(reviewBody, event, reviewUrl);

	if (progressCommentId) {
		await safeOperation(
			async () => {
				try {
					await provider.updateComment(workItemId, progressCommentId, formatted);
				} catch {
					await provider.addComment(workItemId, formatted);
				}
			},
			{
				action: 'post review summary to PM work item',
				workItemId,
			},
		);
	} else {
		await safeOperation(() => provider.addComment(workItemId, formatted), {
			action: 'post review summary to PM work item',
			workItemId,
		});
	}
}

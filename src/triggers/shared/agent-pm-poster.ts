/**
 * Utility for posting agent summaries to the PM work item (card/issue).
 *
 * Handles two cases:
 * - **Review agent**: structured session state (reviewBody/reviewEvent/reviewUrl)
 * - **Output-based agents** (respond-to-ci, respond-to-review, resolve-conflicts):
 *   free-form AgentResult.output with per-agent-type formatting
 *
 * Best-effort: failures are silently swallowed via safeOperation so they
 * never block the agent flow.
 */

import { getPMProviderOrNull } from '../../pm/index.js';
import { logger } from '../../utils/logging.js';
import { safeOperation } from '../../utils/safeOperation.js';

const MAX_BODY_LENGTH = 15_000; // Leave headroom below Trello's 16K limit
const TRUNCATION_NOTICE = '\n\n_[Review body truncated — view full review on GitHub]_';

/**
 * Per-agent-type config for formatting agent output.
 *
 * Every agent type that posts its `AgentResult.output` to PM must have an entry here.
 * The `review` agent is NOT listed — it uses `formatReviewForPM` via structured session state.
 * `PM_SUMMARY_AGENT_TYPES` is derived from these keys + `'review'`.
 */
const AGENT_OUTPUT_CONFIG: Record<string, { emoji: string; header: string }> = {
	'respond-to-ci': { emoji: '🔧', header: 'CI Fix Summary' },
	'respond-to-review': { emoji: '💬', header: 'Review Response Summary' },
	'resolve-conflicts': { emoji: '🔀', header: 'Conflict Resolution Summary' },
};

/** Agent types that post summaries to PM after successful runs. */
export const PM_SUMMARY_AGENT_TYPES = new Set(['review', ...Object.keys(AGENT_OUTPUT_CONFIG)]);

/**
 * Whether the given agent type uses `AgentResult.output` for PM posting
 * (as opposed to structured session state like the review agent).
 */
export function isOutputBasedAgent(agentType: string): boolean {
	return agentType in AGENT_OUTPUT_CONFIG;
}

/** Event-type emoji mapping for review headers */
const EVENT_EMOJI: Record<string, string> = {
	APPROVE: '✅',
	REQUEST_CHANGES: '🔄',
	COMMENT: '💬',
};

const AGENT_OUTPUT_MAX = 2_000; // Tail-extract limit for agent output
const AGENT_OUTPUT_TRUNCATION_NOTICE = '\n\n_[Output truncated — showing last portion]_';

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
 * Format agent output for posting as a PM comment.
 *
 * If output exceeds 2000 chars, takes the last 2000 chars on a newline boundary
 * (accounting for the truncation notice within the limit).
 * Total result is capped at 15K (Trello's 16K limit with headroom).
 */
export function formatAgentOutputForPM(agentType: string, output: string): string {
	const config = AGENT_OUTPUT_CONFIG[agentType];
	if (!config) {
		// Unknown agent type — apply length cap but no formatting
		return output.length > MAX_BODY_LENGTH ? output.slice(0, MAX_BODY_LENGTH) : output;
	}

	const header = `${config.emoji} **${config.header}**\n\n`;

	let body = output;
	if (body.length > AGENT_OUTPUT_MAX) {
		// Tail-extract: take last AGENT_OUTPUT_MAX chars (minus notice), break on newline boundary
		const budget = AGENT_OUTPUT_MAX - AGENT_OUTPUT_TRUNCATION_NOTICE.length;
		const tail = body.slice(-budget);
		const newlineIdx = tail.indexOf('\n');
		body = (newlineIdx > 0 ? tail.slice(newlineIdx + 1) : tail) + AGENT_OUTPUT_TRUNCATION_NOTICE;
	}

	let result = `${header}${body}`;
	if (result.length > MAX_BODY_LENGTH) {
		result = result.slice(0, MAX_BODY_LENGTH);
	}

	return result;
}

/**
 * Post formatted text to a PM work item, updating an existing comment or creating a new one.
 *
 * @param callerName - Identifier for log messages (e.g. 'postReviewToPM', 'postAgentOutputToPM')
 * @param label - Human-readable description for log context (e.g. 'review summary')
 */
async function postFormattedToPM(
	workItemId: string,
	formatted: string,
	callerName: string,
	label: string,
	progressCommentId?: string,
): Promise<void> {
	const provider = getPMProviderOrNull();
	if (!provider) {
		logger.warn(`${callerName} skipped: no PM provider available`, { workItemId });
		return;
	}

	if (progressCommentId) {
		await safeOperation(
			async () => {
				try {
					await provider.updateComment(workItemId, progressCommentId, formatted);
					logger.info(`Updated existing PM comment with ${label}`, {
						workItemId,
						progressCommentId,
					});
				} catch {
					await provider.addComment(workItemId, formatted);
					logger.info(`Added new PM comment with ${label} (update failed)`, {
						workItemId,
						progressCommentId,
					});
				}
			},
			{
				action: `post ${label} to PM work item`,
				workItemId,
			},
		);
	} else {
		await safeOperation(
			async () => {
				await provider.addComment(workItemId, formatted);
				logger.info(`Added new PM comment with ${label}`, { workItemId });
			},
			{
				action: `post ${label} to PM work item`,
				workItemId,
			},
		);
	}
}

/**
 * Post the review summary to the PM work item as a comment.
 *
 * Guards:
 * - sessionState must have a reviewBody and reviewUrl
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

	if (!reviewBody || !reviewUrl) {
		logger.warn('postReviewToPM skipped: missing reviewBody or reviewUrl', {
			hasBody: !!reviewBody,
			hasUrl: !!reviewUrl,
			workItemId,
		});
		return;
	}

	const event = reviewEvent ?? 'COMMENT';
	const formatted = formatReviewForPM(reviewBody, event, reviewUrl);

	await postFormattedToPM(
		workItemId,
		formatted,
		'postReviewToPM',
		'review summary',
		progressCommentId,
	);
}

/**
 * Post agent output to the PM work item as a comment.
 *
 * Used by respond-to-ci, respond-to-review, and resolve-conflicts agents
 * to replace the progress comment with their final output.
 *
 * @param workItemId - The PM work item ID to post to
 * @param agentType - The agent type (for formatting)
 * @param output - The agent's free-form output text
 * @param progressCommentId - Optional ID of an existing PM progress comment to update in-place
 */
export async function postAgentOutputToPM(
	workItemId: string,
	agentType: string,
	output: string,
	progressCommentId?: string,
): Promise<void> {
	if (!output?.trim()) {
		logger.warn('postAgentOutputToPM skipped: empty output', { workItemId, agentType });
		return;
	}

	const formatted = formatAgentOutputForPM(agentType, output);

	await postFormattedToPM(
		workItemId,
		formatted,
		'postAgentOutputToPM',
		`${agentType} summary`,
		progressCommentId,
	);
}

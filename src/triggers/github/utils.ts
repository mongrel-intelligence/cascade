import type { ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';

// Trello card URL pattern: https://trello.com/c/SHORT_ID/optional-slug
const TRELLO_CARD_URL_REGEX = /https:\/\/trello\.com\/c\/([a-zA-Z0-9]+)/;

// JIRA issue key pattern: PROJECT-123
const JIRA_ISSUE_KEY_REGEX = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/**
 * Extract Trello card short ID from text (e.g., PR body).
 * Returns the short ID (e.g., "abc123" from "https://trello.com/c/abc123/card-name")
 * which can be used with Trello API.
 */
export function extractTrelloCardId(text: string | null): string | null {
	if (!text) return null;
	const match = text.match(TRELLO_CARD_URL_REGEX);
	return match ? match[1] : null;
}

/**
 * Check if text contains a Trello card URL.
 */
export function hasTrelloCardUrl(text: string | null): boolean {
	return extractTrelloCardId(text) !== null;
}

/**
 * Extract full Trello card URL from text.
 */
export function extractTrelloCardUrl(text: string | null): string | null {
	if (!text) return null;
	const match = text.match(TRELLO_CARD_URL_REGEX);
	return match ? match[0] : null;
}

/**
 * Validate PR body has Trello card URL and extract card ID.
 * Returns card ID or null (with logging) if not found.
 */
export function requireTrelloCardId(
	prBody: string | null,
	context: { prNumber: number; triggerName: string },
): string | null {
	if (!hasTrelloCardUrl(prBody)) {
		logger.info(`PR does not have Trello card URL, skipping ${context.triggerName}`, {
			prNumber: context.prNumber,
		});
		return null;
	}
	return extractTrelloCardId(prBody);
}

/**
 * Extract a JIRA issue key (e.g., "PROJ-123") from text.
 */
export function extractJiraIssueKey(text: string | null): string | null {
	if (!text) return null;
	const match = text.match(JIRA_ISSUE_KEY_REGEX);
	return match ? match[1] : null;
}

/**
 * Extract work item ID from text based on the project's PM type.
 * For Trello projects, looks for Trello card URLs.
 * For JIRA projects, looks for JIRA issue keys.
 */
export function extractWorkItemId(text: string | null, project: ProjectConfig): string | null {
	if (!text) return null;
	if (project.pm?.type === 'jira') {
		return extractJiraIssueKey(text);
	}
	return extractTrelloCardId(text);
}

/**
 * Validate PR body has a work item reference and extract the ID.
 * Works for both Trello (card URL) and JIRA (issue key) projects.
 */
export function requireWorkItemId(
	prBody: string | null,
	project: ProjectConfig,
	context: { prNumber: number; triggerName: string },
): string | null {
	const id = extractWorkItemId(prBody, project);
	if (!id) {
		logger.info(`PR does not have work item reference, skipping ${context.triggerName}`, {
			prNumber: context.prNumber,
			pmType: project.pm?.type ?? 'trello',
		});
	}
	return id;
}

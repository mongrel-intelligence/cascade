import { getAuthenticatedUser } from '../../github/client.js';
import { logger } from '../../utils/logging.js';

// Trello card URL pattern: https://trello.com/c/SHORT_ID/optional-slug
const TRELLO_CARD_URL_REGEX = /https:\/\/trello\.com\/c\/([a-zA-Z0-9]+)/;

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
 * Check if a comment/review author is the authenticated (implementation) user.
 * Used to skip self-authored events and avoid loops.
 */
export async function isAuthenticatedUser(author: string): Promise<boolean> {
	try {
		const authenticatedUser = await getAuthenticatedUser();
		return author === authenticatedUser || author === `${authenticatedUser}[bot]`;
	} catch {
		return false;
	}
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

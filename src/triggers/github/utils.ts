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

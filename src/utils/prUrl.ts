/**
 * Extract a GitHub PR URL from text.
 * Matches GitHub PR URLs of the form: https://github.com/owner/repo/pull/123
 */
export function extractPRUrl(text: string): string | undefined {
	// Stricter regex that stops at word boundaries, quotes, or parentheses
	const match = text.match(/https:\/\/github\.com\/[^\s"')\]]+\/pull\/\d+/);
	return match ? match[0] : undefined;
}

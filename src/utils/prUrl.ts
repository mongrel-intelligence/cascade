/**
 * Extract a GitHub PR URL from text output.
 * Supports standard GitHub PR URLs with improved pattern matching.
 */
export function extractPRUrl(text: string): string | undefined {
	// Match GitHub PR URLs, excluding trailing punctuation and quotes
	const match = text.match(/https:\/\/github\.com\/[^\s"')\]]+\/pull\/\d+/);
	return match ? match[0] : undefined;
}

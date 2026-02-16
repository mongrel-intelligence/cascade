/**
 * Extract a GitHub PR URL from text.
 *
 * Supports both plain text output and URLs within quotes/brackets.
 */
export function extractPRUrl(text: string): string | undefined {
	// More permissive regex that handles URLs in quotes, parentheses, or brackets
	const match = text.match(/https:\/\/github\.com\/[^\s"')\]]+\/pull\/\d+/);
	return match ? match[0] : undefined;
}

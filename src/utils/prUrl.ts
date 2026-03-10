/**
 * Shared utility for extracting GitHub PR URLs from text.
 * Used by the Claude Code backend (backends/claude-code/index.ts) to extract
 * PR URLs from agent output and assistant messages.
 */

/**
 * Extract a GitHub PR URL from arbitrary text output.
 * Matches the first occurrence of a GitHub pull request URL.
 *
 * @param text - The text to search for a PR URL
 * @returns The PR URL if found, or undefined
 */
export function extractPRUrl(text: string): string | undefined {
	const match = text.match(/https:\/\/github\.com\/[^\s"')\]]+\/pull\/\d+/);
	return match ? match[0] : undefined;
}

/**
 * Extract the PR number from a URL or arbitrary text containing a `/pull/NNN` path.
 */
export function extractPRNumber(text: string): number | undefined {
	const match = text.match(/\/pull\/(\d+)/);
	return match ? Number(match[1]) : undefined;
}

/**
 * Shared utility for extracting GitHub PR URLs from text.
 * Used by both the llmist backend (agents/base.ts) and the
 * Claude Code backend (backends/claude-code/index.ts) to avoid duplication.
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

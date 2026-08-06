/**
 * Shared utility for extracting PR/MR URLs from text.
 * Supports both GitHub PRs (/pull/NNN) and GitLab MRs (/merge_requests/NNN).
 * Used by the Claude Code backend (backends/claude-code/index.ts) to extract
 * PR/MR URLs from agent output and assistant messages.
 */

/**
 * Extract a GitHub PR or GitLab MR URL from arbitrary text output.
 * Matches the first occurrence of either URL pattern.
 *
 * @param text - The text to search for a PR/MR URL
 * @returns The PR/MR URL if found, or undefined
 */
export function extractPRUrl(text: string): string | undefined {
	// GitHub: https://github.com/owner/repo/pull/123
	const ghMatch = text.match(/https:\/\/github\.com\/[^\s"')\]]+\/pull\/\d+/);
	if (ghMatch) return ghMatch[0];
	// GitLab: https://gitlab.example.com/group/repo/-/merge_requests/123
	const glMatch = text.match(/https?:\/\/[^\s"')\]]+\/-\/merge_requests\/\d+/);
	return glMatch ? glMatch[0] : undefined;
}

/**
 * Extract the PR/MR number from a URL or arbitrary text.
 * Matches GitHub `/pull/NNN` and GitLab `/merge_requests/NNN` patterns.
 */
export function extractPRNumber(text: string): number | undefined {
	// GitHub: /pull/123
	const ghMatch = text.match(/\/pull\/(\d+)/);
	if (ghMatch) return Number(ghMatch[1]);
	// GitLab: /merge_requests/123 (also /-/merge_requests/123)
	const glMatch = text.match(/\/merge_requests\/(\d+)/);
	return glMatch ? Number(glMatch[1]) : undefined;
}

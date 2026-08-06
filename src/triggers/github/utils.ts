import { lookupWorkItemForPR } from '../../db/repositories/prWorkItemsRepository.js';
import { getPMProviderOrNull } from '../../pm/context.js';
import type { ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';

// Re-export the author-mode evaluator from its canonical shared home so
// `pr-opened.ts` and `tests/unit/triggers/github-utils.test.ts` keep working
// untouched. The core logic now lives in `src/triggers/shared/author-mode.ts`.
export {
	type AuthorMode,
	type AuthorModeResult,
	evaluateAuthorMode,
	resolveAuthorMode,
} from '../shared/author-mode.js';

/**
 * Extract PR number from GitHub's refs/pull/{N}/head virtual ref.
 * Returns null if the ref doesn't match the pattern.
 *
 * GitHub fires check_suite webhooks with pull_requests: [] when checks run on
 * the refs/pull/{N}/head virtual ref rather than the named feature branch.
 * Matching only "head" (not "merge") avoids acting on the synthetic merge-commit
 * SHA that is not part of the PR branch history.
 */
export function parsePrNumberFromRef(headBranch: string | null | undefined): number | null {
	if (!headBranch) return null;
	const match = headBranch.match(/^refs\/pull\/(\d+)\/head$/);
	return match ? Number.parseInt(match[1], 10) : null;
}

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
 * Resolve work item ID for a PR using DB lookup only (pr_work_items table).
 * Returns undefined when DB returns null or throws.
 */
export async function resolveWorkItemId(
	projectId: string,
	prNumber: number,
): Promise<string | undefined> {
	try {
		const dbResult = await lookupWorkItemForPR(projectId, prNumber);
		if (dbResult) return dbResult;
	} catch (err) {
		logger.warn('Failed to look up work item from DB', {
			projectId,
			prNumber,
			error: String(err),
		});
	}

	return undefined;
}

/**
 * Fetch work item display data (URL and title) from the active PM provider.
 *
 * Best-effort: returns an empty object on any error so callers can safely
 * spread the result without checking for failure. Requires a PM provider
 * to be in scope (set up by `withPMScope`).
 *
 * @param workItemId - The work item ID to look up (Trello card ID, JIRA issue key, etc.)
 */
export async function resolveWorkItemDisplayData(
	workItemId: string | undefined,
): Promise<{ workItemUrl?: string; workItemTitle?: string }> {
	if (!workItemId) return {};
	try {
		const provider = getPMProviderOrNull();
		if (!provider) return {};
		const workItem = await provider.getWorkItem(workItemId);
		return {
			workItemUrl: workItem.url ?? undefined,
			workItemTitle: workItem.title ?? undefined,
		};
	} catch (err) {
		logger.debug('Could not resolve work item display data (best-effort)', {
			workItemId,
			error: String(err),
		});
		return {};
	}
}

/** Escape a string for safe use as a literal inside a RegExp. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Return the last non-empty (trimmed) line of a block of text, or null.
 * PR descriptions conventionally carry the work-item key on a trailing line, so
 * restricting body parsing to that line keeps prose that mentions other tokens
 * from producing false matches.
 */
function lastNonEmptyLine(text: string | null | undefined): string | null {
	if (!text) return null;
	const lines = text.split(/\r\n|\r|\n/);
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].trim() !== '') return lines[i];
	}
	return null;
}

/**
 * Extract a JIRA issue key for THIS project from a PR's branch, title, or the
 * last non-empty line of its body. The regex is scoped to the project's
 * `projectKey` (case-insensitive), so generic tokens like `UTF-8` / `SHA-256`,
 * or another project's keys, never match. Returns the upper-cased key or null.
 * JIRA only — Trello/Linear are out of scope for this fallback.
 */
export function extractJiraKeyFromPR(
	project: ProjectConfig,
	prText: { branch?: string | null; title?: string | null; body?: string | null },
): string | null {
	if (project.pm?.type !== 'jira') return null;
	const projectKey = project.jira?.projectKey;
	if (!projectKey) return null;

	const keyRegex = new RegExp(`\\b(${escapeRegExp(projectKey)}-\\d+)\\b`, 'i');
	// Priority: branch, then title, then the body's last non-empty line.
	const sources = [prText.branch, prText.title, lastNonEmptyLine(prText.body)];
	for (const source of sources) {
		const match = source?.match(keyRegex);
		if (match) return match[1].toUpperCase();
	}
	return null;
}

/**
 * Resolve the work item for a PR, falling back to deriving the JIRA key from the
 * PR itself when no `pr_work_items` link exists yet. This lets a review-only
 * project (with no implementation agent to write the link) read the linked JIRA
 * issue for a human-created PR that references its key.
 *
 * The derived key is verified against the PM provider before it is returned, so
 * a typo'd / non-existent key is not linked (a later DB hit would otherwise
 * short-circuit this fallback and make the bad key stick). Requires a PM
 * provider in scope (set up by the dispatch path's `withPMProvider`).
 */
export async function resolveWorkItemIdWithFallback(
	project: ProjectConfig,
	prNumber: number,
	prText: { branch?: string | null; title?: string | null; body?: string | null },
): Promise<string | undefined> {
	const linked = await resolveWorkItemId(project.id, prNumber);
	if (linked) return linked;

	const candidate = extractJiraKeyFromPR(project, prText);
	if (!candidate) return undefined;

	const provider = getPMProviderOrNull();
	if (!provider) return undefined;
	try {
		await provider.getWorkItem(candidate);
		return candidate;
	} catch (err) {
		logger.debug('Derived work item key did not resolve — not linking', {
			projectId: project.id,
			prNumber,
			candidate,
			error: String(err),
		});
		return undefined;
	}
}

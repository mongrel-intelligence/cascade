import { lookupWorkItemForPR } from '../../db/repositories/prWorkItemsRepository.js';
import type { ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';

export interface AuthorModeResult {
	shouldTrigger: boolean;
	authorMode: string;
	isImplementerPR: boolean;
}

/**
 * Evaluate whether a trigger should fire based on the PR author and the
 * configured `authorMode` parameter.
 *
 * Returns `null` when personaIdentities is missing (caller should return null).
 * Validates authorMode against known values and falls back to 'own'.
 */
export function evaluateAuthorMode(
	prAuthorLogin: string,
	personaIdentities: { implementer: string } | undefined,
	parameters: Record<string, unknown>,
	handlerName: string,
): AuthorModeResult | null {
	if (!personaIdentities) {
		logger.info('No persona identities available, skipping', { handler: handlerName });
		return null;
	}
	const implLogin = personaIdentities.implementer;
	const isImplementerPR = prAuthorLogin === implLogin || prAuthorLogin === `${implLogin}[bot]`;

	const rawMode = parameters.authorMode;
	const authorMode =
		typeof rawMode === 'string' && ['own', 'external', 'all'].includes(rawMode) ? rawMode : 'own';

	if (typeof rawMode === 'string' && authorMode !== rawMode) {
		logger.warn('Invalid authorMode value, falling back to "own"', {
			handler: handlerName,
			configuredValue: rawMode,
		});
	}

	const shouldTrigger =
		authorMode === 'all' ||
		(authorMode === 'own' && isImplementerPR) ||
		(authorMode === 'external' && !isImplementerPR);

	return { shouldTrigger, authorMode, isImplementerPR };
}

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

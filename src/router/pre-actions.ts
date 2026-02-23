import { findProjectByRepo, getIntegrationCredential } from '../config/provider.js';
import { parseRepoFullName } from '../utils/repo.js';
import { resolveGitHubHeaders } from './platformClients.js';
import type { GitHubJob } from './queue.js';

/**
 * Module-level cache for reviewer GitHub usernames.
 * Keyed by project ID. Cached per process lifetime.
 */
const reviewerUsernameCache = new Map<string, string>();

/**
 * Clear the reviewer username cache. Used in tests only.
 * @internal
 */
export function _clearReviewerUsernameCache(): void {
	reviewerUsernameCache.clear();
}

/**
 * Resolve the GitHub username for the reviewer persona.
 * Cached per project ID to minimise API calls.
 */
async function getReviewerUsername(projectId: string, token: string): Promise<string | null> {
	const cached = reviewerUsernameCache.get(projectId);
	if (cached) return cached;

	const response = await fetch('https://api.github.com/user', {
		headers: resolveGitHubHeaders(token),
	});

	if (!response.ok) {
		console.warn('[PreActions] Failed to resolve reviewer username:', response.status);
		return null;
	}

	const data = (await response.json()) as Record<string, unknown>;
	const login = data.login as string | undefined;
	if (!login) return null;

	reviewerUsernameCache.set(projectId, login);
	return login;
}

/**
 * Add a 👀 (eyes) reaction to the PR body comment when a check_suite success
 * arrives and the reviewer persona has no prior reviews on the PR.
 *
 * Follows the notifications.ts pattern:
 * - Raw fetch (no Octokit) — router image doesn't include github/client.ts
 * - Fire-and-forget: caller wraps in .catch()
 * - Never throws — all errors are caught and logged
 */
export async function addEyesReactionToPR(job: GitHubJob): Promise<void> {
	const payload = job.payload as Record<string, unknown>;
	const suite = payload.check_suite as Record<string, unknown> | undefined;
	const prs = suite?.pull_requests as Array<Record<string, unknown>> | undefined;

	if (!prs || prs.length === 0) {
		return;
	}

	const prNumber = prs[0].number as number | undefined;
	if (!prNumber) return;

	const repoFullName = job.repoFullName;

	// Resolve project
	const project = await findProjectByRepo(repoFullName);
	if (!project) {
		console.warn('[PreActions] No project found for repo, skipping eyes reaction', {
			repoFullName,
		});
		return;
	}

	// Get reviewer token
	let reviewerToken: string;
	try {
		reviewerToken = await getIntegrationCredential(project.id, 'scm', 'reviewer_token');
	} catch {
		console.warn('[PreActions] Missing GITHUB_TOKEN_REVIEWER, skipping eyes reaction');
		return;
	}

	// Resolve reviewer username (cached)
	const reviewerUsername = await getReviewerUsername(project.id, reviewerToken);
	if (!reviewerUsername) {
		console.warn('[PreActions] Could not resolve reviewer username, skipping eyes reaction');
		return;
	}

	// Fetch existing reviews to check for prior reviews from the reviewer
	const { owner, repo } = parseRepoFullName(repoFullName);
	const reviewsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`;
	const reviewsResponse = await fetch(reviewsUrl, {
		headers: resolveGitHubHeaders(reviewerToken),
	});

	if (!reviewsResponse.ok) {
		console.warn(
			'[PreActions] Failed to fetch PR reviews:',
			reviewsResponse.status,
			await reviewsResponse.text(),
		);
		return;
	}

	const reviews = (await reviewsResponse.json()) as Array<Record<string, unknown>>;

	// Only consider approved/changes_requested (not COMMENTED) — matches check-suite-success.ts logic
	const priorReviews = reviews.filter((r) => {
		const user = r.user as Record<string, unknown> | undefined;
		return (
			user?.login === reviewerUsername &&
			(r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')
		);
	});

	if (priorReviews.length > 0) {
		console.log('[PreActions] Reviewer has prior reviews on PR, skipping eyes reaction', prNumber);
		return;
	}

	// Add 👀 reaction to the PR (issue number = PR number)
	const reactionUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/reactions`;
	const reactionResponse = await fetch(reactionUrl, {
		method: 'POST',
		headers: resolveGitHubHeaders(reviewerToken, { 'Content-Type': 'application/json' }),
		body: JSON.stringify({ content: 'eyes' }),
	});

	if (!reactionResponse.ok) {
		console.warn(
			'[PreActions] Failed to add eyes reaction:',
			reactionResponse.status,
			await reactionResponse.text(),
		);
	} else {
		console.log('[PreActions] Added eyes reaction to PR:', prNumber);
	}
}

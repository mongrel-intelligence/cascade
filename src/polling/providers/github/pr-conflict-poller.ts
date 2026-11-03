/**
 * GitHub PR conflict poller.
 *
 * Polls open PRs for merge conflicts (mergeable_state === 'dirty').
 * Emits synthetic 'synchronize' events that trigger PRConflictDetectedTrigger.
 *
 * Design notes:
 * - Receives openPRs list from PR review poller (no duplicate API call)
 * - Fetches base branch SHA once per distinct base branch per cycle
 * - Checks each (pr, head_sha, base_sha) tuple against ledger
 * - Only fetches PR details for unchecked tuples
 * - Records conflicts immediately after dispatch (not batched)
 * - Records clean checks in batch at end of cycle
 *
 * Limitations:
 * - Truncated to githubPrBatchSize (default 30) most recently updated PRs
 * - Stale PRs (not recently updated) may miss conflict detection if base moves
 */

import type { Octokit } from '@octokit/rest';
import type { RouterPlatformAdapter } from '../../../router/platform-adapter.js';
import type { TriggerRegistry } from '../../../triggers/registry.js';
import { logger } from '../../../utils/logging.js';
import { batchCheckLedger, batchRecordWithoutDispatch, dispatchAndRecord } from '../../dispatch.js';
import {
	buildPRConflictCheckDedupKey,
	buildSyntheticPRConflictPayload,
	type GitHubPullRequest,
} from './types.js';

/**
 * Tracks head SHA seen in the previous cycle for each PR.
 * Key: `${repoFullName}#${prNumber}`
 * Value: head SHA from previous cycle
 *
 * A PR is "settled" when its current head SHA equals the value stored here,
 * meaning the head hasn't changed since the last cycle. This prevents
 * dispatching conflict events for PRs that are actively being pushed to,
 * which would burn the attempt counter without a real agent run (the worker
 * rejects stale SHAs).
 */
const lastSeenHeadSha = new Map<string, string>();

/**
 * Build the key for lastSeenHeadSha map.
 */
function buildSettledKey(repoFullName: string, prNumber: number): string {
	return `${repoFullName}#${prNumber}`;
}

/**
 * Reset settled-head tracking for a specific PR or all PRs.
 * Exported for testing.
 */
export function resetSettledHeadTracking(repoFullName?: string, prNumber?: number): void {
	if (repoFullName !== undefined && prNumber !== undefined) {
		lastSeenHeadSha.delete(buildSettledKey(repoFullName, prNumber));
	} else {
		lastSeenHeadSha.clear();
	}
}

/** Result of a PR conflict poll cycle for a single repo. */
export interface PRConflictPollResult {
	/** Total open PRs checked */
	total: number;
	/** Events dispatched (conflicts found) */
	emitted: number;
	/** PRs skipped (already in ledger or clean) */
	skipped: number;
	/** Errors during processing */
	errors: number;
}

/**
 * Fetch base branch SHA for a given branch.
 * No ETag caching - fetched fresh each cycle per the design.
 */
async function fetchBaseSha(
	octokit: Octokit,
	owner: string,
	repo: string,
	branch: string,
): Promise<string | null> {
	try {
		const { data } = await octokit.git.getRef({
			owner,
			repo,
			ref: `heads/${branch}`,
		});
		return data.object.sha;
	} catch (error) {
		logger.error('Failed to fetch base branch SHA', {
			owner,
			repo,
			branch,
			error: String(error),
		});
		return null;
	}
}

/**
 * Fetch PR mergeable state only.
 */
async function fetchMergeableState(
	octokit: Octokit,
	owner: string,
	repo: string,
	prNumber: number,
): Promise<{ mergeable: boolean | null; mergeableState: string | null } | null> {
	try {
		const { data } = await octokit.pulls.get({
			owner,
			repo,
			pull_number: prNumber,
		});
		return {
			mergeable: data.mergeable ?? null,
			mergeableState: (data as { mergeable_state?: string }).mergeable_state ?? null,
		};
	} catch (error) {
		logger.error('Failed to fetch PR mergeable state', {
			owner,
			repo,
			prNumber,
			error: String(error),
		});
		return null;
	}
}

/**
 * Poll open PRs for merge conflicts.
 *
 * @param projectId - Project ID for ledger operations
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param octokit - GitHub API client
 * @param adapter - Router platform adapter for dispatch
 * @param triggerRegistry - Trigger registry for dispatch
 * @param openPRs - Open PRs list from PR review poller (shared, no extra API call)
 */
export async function pollPRConflictsForRepo(
	projectId: string,
	owner: string,
	repo: string,
	octokit: Octokit,
	adapter: RouterPlatformAdapter,
	triggerRegistry: TriggerRegistry,
	openPRs: GitHubPullRequest[],
): Promise<PRConflictPollResult> {
	const repoFullName = `${owner}/${repo}`;
	const result: PRConflictPollResult = {
		total: openPRs.length,
		emitted: 0,
		skipped: 0,
		errors: 0,
	};

	if (openPRs.length === 0) {
		// Clean up tracking for this repo since no open PRs exist
		for (const key of lastSeenHeadSha.keys()) {
			if (key.startsWith(`${repoFullName}#`)) {
				lastSeenHeadSha.delete(key);
			}
		}
		return result;
	}

	// Clean up tracking for PRs no longer in openPRs
	const currentPRKeys = new Set(openPRs.map((pr) => buildSettledKey(repoFullName, pr.number)));
	for (const key of lastSeenHeadSha.keys()) {
		if (key.startsWith(`${repoFullName}#`) && !currentPRKeys.has(key)) {
			lastSeenHeadSha.delete(key);
		}
	}

	// Group PRs by base branch to minimize ref lookups
	const prsByBase = new Map<string, GitHubPullRequest[]>();
	for (const pr of openPRs) {
		const baseRef = pr.base.ref;
		if (!prsByBase.has(baseRef)) {
			prsByBase.set(baseRef, []);
		}
		prsByBase.get(baseRef)!.push(pr);
	}

	// Fetch base SHA for each distinct base branch
	const baseShas = new Map<string, string>();
	for (const baseRef of prsByBase.keys()) {
		const sha = await fetchBaseSha(octokit, owner, repo, baseRef);
		if (sha) {
			baseShas.set(baseRef, sha);
		} else {
			// Can't check PRs targeting this branch
			const prsAffected = prsByBase.get(baseRef)!.length;
			result.errors += prsAffected;
			logger.warn('Skipping PRs due to failed base SHA fetch', {
				repoFullName,
				baseRef,
				prsAffected,
			});
		}
	}

	// Build dedup keys for all PRs with valid base SHAs
	const dedupKeyMap = new Map<string, { pr: GitHubPullRequest; baseSha: string }>();
	for (const [baseRef, prs] of prsByBase) {
		const baseSha = baseShas.get(baseRef);
		if (!baseSha) continue;

		for (const pr of prs) {
			const dedupKey = buildPRConflictCheckDedupKey(repoFullName, pr.number, pr.head.sha, baseSha);
			dedupKeyMap.set(dedupKey, { pr, baseSha });
		}
	}

	// Batch check which tuples are already in ledger
	const existingKeys = await batchCheckLedger(projectId, 'github', Array.from(dedupKeyMap.keys()));

	// Process PRs not in ledger
	const cleanRecords: Array<{ dedupKey: string }> = [];

	for (const [dedupKey, { pr, baseSha }] of dedupKeyMap) {
		// Update settled-head tracking FIRST, before any continue/skip paths.
		// This ensures every open PR's head SHA is recorded every cycle,
		// regardless of ledger state, API errors, or mergeable state.
		const settledKey = buildSettledKey(repoFullName, pr.number);
		const previousHeadSha = lastSeenHeadSha.get(settledKey);
		lastSeenHeadSha.set(settledKey, pr.head.sha);

		if (existingKeys.has(dedupKey)) {
			result.skipped++;
			continue;
		}

		// Fetch PR mergeable state
		const state = await fetchMergeableState(octokit, owner, repo, pr.number);
		if (!state) {
			result.errors++;
			continue;
		}

		// If mergeable is null or state is unknown, skip without recording
		// Will retry next cycle
		if (state.mergeable === null || state.mergeableState === 'unknown') {
			logger.debug('PR mergeable state not yet computed, will retry', {
				prNumber: pr.number,
				mergeable: state.mergeable,
				mergeableState: state.mergeableState,
			});
			result.skipped++;
			continue;
		}

		// Check for conflicts
		if (state.mergeableState === 'dirty') {
			// Check if head SHA is settled (existed AND equals current)
			if (previousHeadSha !== pr.head.sha) {
				// Head SHA changed or first time seeing this PR - defer dispatch
				logger.debug('PR conflict deferred: head SHA not settled', {
					prNumber: pr.number,
					headSha: pr.head.sha,
					previousHeadSha: previousHeadSha ?? 'none',
				});
				result.skipped++;
				// No ledger write - will retry next cycle
				continue;
			}

			// Head SHA is settled - dispatch conflict event immediately and record
			const payload = buildSyntheticPRConflictPayload(pr, repoFullName, baseSha);
			const dispatchResult = await dispatchAndRecord(
				projectId,
				'github',
				'pr_conflict',
				dedupKey,
				payload,
				adapter,
				triggerRegistry,
			);

			if (dispatchResult.error) {
				result.errors++;
				logger.error('Failed to dispatch PR conflict event', {
					prNumber: pr.number,
					error: String(dispatchResult.error),
				});
			} else if (dispatchResult.enqueued) {
				result.emitted++;
				logger.info('Dispatched PR conflict event', {
					prNumber: pr.number,
					headSha: pr.head.sha,
					baseSha,
				});
			} else {
				// Skipped by trigger (e.g., disabled, author mode, etc.)
				result.skipped++;
			}
		} else {
			// Clean PR - batch record at end
			// (tracking already updated at top of loop)
			cleanRecords.push({ dedupKey });
			result.skipped++;
		}
	}

	// Batch record clean PRs
	if (cleanRecords.length > 0) {
		await batchRecordWithoutDispatch(
			projectId,
			'github',
			cleanRecords.map((r) => ({
				eventType: 'pr_conflict_checked' as const,
				dedupKey: r.dedupKey,
			})),
		);
		logger.debug('Recorded clean PR conflict checks', {
			repoFullName,
			count: cleanRecords.length,
		});
	}

	return result;
}

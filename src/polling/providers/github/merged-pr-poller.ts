/**
 * GitHub merged PR poller.
 *
 * Polls for PRs that have been merged since the last watermark.
 * Uses the watermark timestamp to filter PRs by merged_at.
 */

import type { Octokit } from '@octokit/rest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import { pollingWatermarks } from '../../../db/schema/polling.js';
import type { RouterPlatformAdapter } from '../../../router/platform-adapter.js';
import type { TriggerRegistry } from '../../../triggers/registry.js';
import { logger } from '../../../utils/logging.js';
import { WATERMARK_OVERLAP_MS } from '../../config.js';
import { batchCheckLedger, dispatchAndRecord, type PollingEventType } from '../../dispatch.js';
import {
	buildMergedPRDedupKey,
	buildSyntheticMergedPRPayload,
	type GitHubPullRequest,
} from './types.js';

/** Result of a merged PR poll cycle for a single repo. */
export interface MergedPRPollResult {
	total: number;
	emitted: number;
	skipped: number;
	errors: number;
}

/**
 * Get the watermark for merged PRs for a specific repo.
 */
async function getWatermark(projectId: string, resourceId: string): Promise<Date | null> {
	const db = getDb();
	const result = await db.query.pollingWatermarks.findFirst({
		where: and(
			eq(pollingWatermarks.projectId, projectId),
			eq(pollingWatermarks.provider, 'github'),
			eq(pollingWatermarks.resourceType, 'merged_prs'),
			eq(pollingWatermarks.resourceId, resourceId),
		),
	});
	return result?.watermark ?? null;
}

/**
 * Update the watermark for merged PRs for a specific repo.
 */
async function updateWatermark(
	projectId: string,
	resourceId: string,
	watermark: Date,
): Promise<void> {
	const db = getDb();
	await db
		.insert(pollingWatermarks)
		.values({
			projectId,
			provider: 'github',
			resourceType: 'merged_prs',
			resourceId,
			watermark,
		})
		.onConflictDoUpdate({
			target: [
				pollingWatermarks.projectId,
				pollingWatermarks.provider,
				pollingWatermarks.resourceType,
				pollingWatermarks.resourceId,
			],
			set: {
				watermark,
				updatedAt: new Date(),
			},
		});
}

/**
 * Poll merged PRs for a single repository.
 */
export async function pollMergedPRsForRepo(
	projectId: string,
	owner: string,
	repo: string,
	octokit: Octokit,
	adapter: RouterPlatformAdapter,
	triggerRegistry: TriggerRegistry,
): Promise<MergedPRPollResult> {
	const repoFullName = `${owner}/${repo}`;
	const result: MergedPRPollResult = {
		total: 0,
		emitted: 0,
		skipped: 0,
		errors: 0,
	};

	// Capture cycle start time BEFORE any fetches or watermark reads.
	// This is used to compute the new watermark with overlap window.
	const cycleStart = new Date();

	// Get watermark
	const watermark = await getWatermark(projectId, repoFullName);
	const sinceDate = watermark ?? new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: 24 hours ago

	// Fetch recently closed PRs (includes merged ones)
	// We need to fetch closed PRs and filter for merged ones
	let closedPRs: GitHubPullRequest[] = [];
	try {
		const { data } = await octokit.pulls.list({
			owner,
			repo,
			state: 'closed',
			sort: 'updated',
			direction: 'desc',
			per_page: 100,
		});

		// Filter to only merged PRs that were merged after the watermark
		closedPRs = data
			.filter((pr) => {
				if (!pr.merged_at) return false;
				const mergedAt = new Date(pr.merged_at);
				return mergedAt > sinceDate;
			})
			.map((pr) => ({
				number: pr.number,
				title: pr.title,
				body: pr.body,
				state: pr.state as 'open' | 'closed',
				html_url: pr.html_url,
				head: {
					ref: pr.head.ref,
					sha: pr.head.sha,
				},
				base: {
					ref: pr.base.ref,
				},
				user: {
					login: pr.user?.login ?? 'unknown',
				},
				merged: true,
				merged_at: pr.merged_at,
				updated_at: pr.updated_at,
			}));
	} catch (error) {
		logger.error('Failed to fetch closed PRs', { repoFullName, error: String(error) });
		return result;
	}

	result.total = closedPRs.length;

	if (closedPRs.length === 0) {
		// Update watermark to cycleStart - overlap to prevent race conditions
		await updateWatermark(
			projectId,
			repoFullName,
			new Date(cycleStart.getTime() - WATERMARK_OVERLAP_MS),
		);
		return result;
	}

	// Batch check ledger
	const dedupKeys = closedPRs.map((pr) => buildMergedPRDedupKey(owner, repo, pr.number));
	const existingKeys = await batchCheckLedger(projectId, 'github', dedupKeys);

	const newMergedPRs = closedPRs.filter(
		(pr) => !existingKeys.has(buildMergedPRDedupKey(owner, repo, pr.number)),
	);

	logger.debug('Merged PRs ledger check', {
		repoFullName,
		total: closedPRs.length,
		existing: existingKeys.size,
		new: newMergedPRs.length,
	});

	result.skipped = existingKeys.size;

	// Dispatch new merged PRs
	for (const pr of newMergedPRs) {
		const dedupKey = buildMergedPRDedupKey(owner, repo, pr.number);
		const syntheticPayload = buildSyntheticMergedPRPayload(pr, repoFullName);

		const dispatchResult = await dispatchAndRecord(
			projectId,
			'github',
			'merged_pr' as PollingEventType,
			dedupKey,
			syntheticPayload,
			adapter,
			triggerRegistry,
		);

		if (dispatchResult.error) {
			result.errors++;
			logger.error('Failed to dispatch merged PR event', {
				repoFullName,
				prNumber: pr.number,
				error: dispatchResult.error.message,
			});
		} else if (dispatchResult.enqueued || dispatchResult.skipped) {
			result.emitted++;
		}
	}

	// Only update watermark if no errors
	// Use cycleStart - overlap to prevent race conditions where merges
	// occurring during cycle execution could be missed
	if (result.errors === 0) {
		await updateWatermark(
			projectId,
			repoFullName,
			new Date(cycleStart.getTime() - WATERMARK_OVERLAP_MS),
		);
	}

	return result;
}

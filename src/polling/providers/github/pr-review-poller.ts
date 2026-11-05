/**
 * GitHub PR review poller.
 *
 * Polls for PR reviews on open PRs that have been updated since the last
 * watermark. Uses the watermark timestamp to filter reviews by submitted_at.
 */

import type { Octokit } from '@octokit/rest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import { pollingWatermarks } from '../../../db/schema/polling.js';
import type { RouterPlatformAdapter } from '../../../router/platform-adapter.js';
import type { TriggerRegistry } from '../../../triggers/registry.js';
import { logger } from '../../../utils/logging.js';
import { pollingConfig, WATERMARK_OVERLAP_MS } from '../../config.js';
import { batchCheckLedger, dispatchAndRecord, type PollingEventType } from '../../dispatch.js';
import {
	buildPRReviewDedupKey,
	buildSyntheticPRReviewPayload,
	type GitHubPRReview,
	type GitHubPullRequest,
} from './types.js';

/** Result of a PR review poll cycle for a single repo. */
export interface PRReviewPollResult {
	total: number;
	emitted: number;
	skipped: number;
	errors: number;
	/** Open PRs fetched this cycle, passed to conflict poller. */
	openPRs: GitHubPullRequest[];
}

/**
 * Get the watermark for PR reviews for a specific repo.
 */
async function getWatermark(projectId: string, resourceId: string): Promise<Date | null> {
	const db = getDb();
	const result = await db.query.pollingWatermarks.findFirst({
		where: and(
			eq(pollingWatermarks.projectId, projectId),
			eq(pollingWatermarks.provider, 'github'),
			eq(pollingWatermarks.resourceType, 'pr_reviews'),
			eq(pollingWatermarks.resourceId, resourceId),
		),
	});
	return result?.watermark ?? null;
}

/**
 * Update the watermark for PR reviews for a specific repo.
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
			resourceType: 'pr_reviews',
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
 * Poll PR reviews for a single repository.
 */
export async function pollPRReviewsForRepo(
	projectId: string,
	owner: string,
	repo: string,
	octokit: Octokit,
	adapter: RouterPlatformAdapter,
	triggerRegistry: TriggerRegistry,
): Promise<PRReviewPollResult> {
	const repoFullName = `${owner}/${repo}`;
	const result: PRReviewPollResult = {
		total: 0,
		emitted: 0,
		skipped: 0,
		errors: 0,
		openPRs: [],
	};

	// Capture cycle start time BEFORE any fetches or watermark reads.
	// This is used to compute the new watermark with overlap window.
	const cycleStart = new Date();

	// Get watermark
	const watermark = await getWatermark(projectId, repoFullName);
	const sinceDate = watermark ?? new Date(Date.now() - 60 * 60 * 1000); // Default: 1 hour ago

	// Fetch open PRs (limited by batch size)
	let openPRs: GitHubPullRequest[] = [];
	try {
		const { data } = await octokit.pulls.list({
			owner,
			repo,
			state: 'open',
			sort: 'updated',
			direction: 'desc',
			per_page: pollingConfig.githubPrBatchSize,
		});
		openPRs = data.map((pr) => ({
			number: pr.number,
			title: pr.title,
			body: pr.body,
			state: pr.state as 'open' | 'closed',
			draft: pr.draft ?? false,
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
			merged: pr.merged_at !== null,
			merged_at: pr.merged_at,
			updated_at: pr.updated_at,
		}));
	} catch (error) {
		logger.error('Failed to fetch open PRs', { repoFullName, error: String(error) });
		result.errors++;
		return result; // openPRs stays empty on fetch failure
	}

	// Store openPRs for conflict poller (even if empty or no reviews found)
	result.openPRs = openPRs;

	if (openPRs.length === 0) {
		// Update watermark to cycleStart - overlap to prevent race conditions
		await updateWatermark(
			projectId,
			repoFullName,
			new Date(cycleStart.getTime() - WATERMARK_OVERLAP_MS),
		);
		return result;
	}

	// Filter to PRs updated since the watermark - skip stale PRs to reduce API calls
	// A PR that hasn't been updated cannot have new reviews
	const recentlyUpdatedPRs = openPRs.filter((pr) => {
		if (!pr.updated_at) return true; // Include if no updated_at (defensive)
		return new Date(pr.updated_at) > sinceDate;
	});

	logger.debug('PR review poll - filtered by updated_at', {
		repoFullName,
		totalOpenPRs: openPRs.length,
		recentlyUpdatedPRs: recentlyUpdatedPRs.length,
		skippedStalePRs: openPRs.length - recentlyUpdatedPRs.length,
	});

	// Collect all reviews from recently updated PRs only
	const allReviews: Array<{ review: GitHubPRReview; pr: GitHubPullRequest }> = [];

	for (const pr of recentlyUpdatedPRs) {
		try {
			const { data: reviews } = await octokit.pulls.listReviews({
				owner,
				repo,
				pull_number: pr.number,
				per_page: 100,
			});

			for (const review of reviews) {
				// Skip pending reviews and reviews before the watermark
				if (review.state === 'PENDING') continue;
				if (!review.submitted_at) continue;

				const submittedAt = new Date(review.submitted_at);
				if (submittedAt <= sinceDate) continue;

				allReviews.push({
					review: {
						id: review.id,
						state: review.state as GitHubPRReview['state'],
						body: review.body ?? null,
						html_url: review.html_url,
						user: {
							login: review.user?.login ?? 'unknown',
						},
						submitted_at: review.submitted_at,
						commit_id: review.commit_id ?? '',
					},
					pr,
				});
			}
		} catch (error) {
			// Increment errors so watermark does NOT advance when review fetch fails
			result.errors++;
			logger.warn('Failed to fetch reviews for PR', {
				repoFullName,
				prNumber: pr.number,
				error: String(error),
			});
		}
	}

	result.total = allReviews.length;

	if (allReviews.length === 0) {
		// Only update watermark if no errors occurred (e.g., all listReviews calls succeeded)
		if (result.errors === 0) {
			await updateWatermark(
				projectId,
				repoFullName,
				new Date(cycleStart.getTime() - WATERMARK_OVERLAP_MS),
			);
		}
		return result;
	}

	// Batch check ledger
	const dedupKeys = allReviews.map(({ review, pr }) =>
		buildPRReviewDedupKey(owner, repo, pr.number, review.id),
	);
	const existingKeys = await batchCheckLedger(projectId, 'github', dedupKeys);

	const newReviews = allReviews.filter(
		({ review, pr }) => !existingKeys.has(buildPRReviewDedupKey(owner, repo, pr.number, review.id)),
	);

	logger.debug('PR reviews ledger check', {
		repoFullName,
		total: allReviews.length,
		existing: existingKeys.size,
		new: newReviews.length,
	});

	result.skipped = existingKeys.size;

	// Dispatch new reviews
	for (const { review, pr } of newReviews) {
		const dedupKey = buildPRReviewDedupKey(owner, repo, pr.number, review.id);
		const syntheticPayload = buildSyntheticPRReviewPayload(review, pr, repoFullName);

		const dispatchResult = await dispatchAndRecord(
			projectId,
			'github',
			'pr_review' as PollingEventType,
			dedupKey,
			syntheticPayload,
			adapter,
			triggerRegistry,
		);

		if (dispatchResult.error) {
			result.errors++;
			logger.error('Failed to dispatch PR review event', {
				repoFullName,
				prNumber: pr.number,
				reviewId: review.id,
				error: dispatchResult.error.message,
			});
		} else if (dispatchResult.enqueued || dispatchResult.skipped) {
			result.emitted++;
		}
	}

	// Only update watermark if no errors
	// Use cycleStart - overlap to prevent race conditions where reviews
	// submitted during cycle execution could be missed
	if (result.errors === 0) {
		await updateWatermark(
			projectId,
			repoFullName,
			new Date(cycleStart.getTime() - WATERMARK_OVERLAP_MS),
		);
	}

	return result;
}

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock DB before imports
const mockFindFirst = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoUpdate = vi.fn().mockResolvedValue({ rowCount: 1 });

vi.mock('../../../../../src/db/client.js', () => ({
	getDb: vi.fn(() => ({
		query: {
			pollingWatermarks: {
				findFirst: mockFindFirst,
			},
		},
		insert: mockInsert,
	})),
}));

vi.mock('../../../../../src/polling/config.js', () => ({
	pollingConfig: {
		githubPrBatchSize: 50,
	},
}));

vi.mock('../../../../../src/polling/dispatch.js', () => ({
	batchCheckLedger: vi.fn().mockResolvedValue(new Set()),
	dispatchAndRecord: vi
		.fn()
		.mockResolvedValue({ recorded: true, deferred: false, skipped: false, enqueued: true }),
}));

vi.mock('../../../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import { batchCheckLedger, dispatchAndRecord } from '../../../../../src/polling/dispatch.js';
import { pollPRReviewsForRepo } from '../../../../../src/polling/providers/github/pr-review-poller.js';
import { buildPRReviewDedupKey } from '../../../../../src/polling/providers/github/types.js';
import type { RouterPlatformAdapter } from '../../../../../src/router/platform-adapter.js';
import type { TriggerRegistry } from '../../../../../src/triggers/registry.js';

const mockAdapter = {
	type: 'github',
} as unknown as RouterPlatformAdapter;

const mockTriggerRegistry = {
	dispatch: vi.fn(),
} as unknown as TriggerRegistry;

function createMockOctokit(
	openPRs: unknown[] = [],
	reviewsMap: Map<number, unknown[]> = new Map(),
) {
	return {
		pulls: {
			list: vi.fn().mockResolvedValue({ data: openPRs }),
			listReviews: vi.fn().mockImplementation(({ pull_number }: { pull_number: number }) => {
				const reviews = reviewsMap.get(pull_number) ?? [];
				return Promise.resolve({ data: reviews });
			}),
		},
	} as unknown as Parameters<typeof pollPRReviewsForRepo>[3];
}

/**
 * Create a mock PR based on GitHub Pull Request API response.
 * Source: https://docs.github.com/en/rest/pulls/pulls#list-pull-requests
 */
function createMockPR(
	overrides: Partial<{
		number: number;
		title: string;
		body: string | null;
		state: string;
		draft: boolean;
		html_url: string;
		head: { ref: string; sha: string };
		base: { ref: string };
		user: { login: string } | null;
		merged_at: string | null;
		updated_at: string;
	}> = {},
) {
	const result: Record<string, unknown> = {
		number: overrides.number ?? 42,
		title: overrides.title ?? 'Test PR',
		body: overrides.body ?? 'PR body',
		state: overrides.state ?? 'open',
		html_url: overrides.html_url ?? 'https://github.com/owner/repo/pull/42',
		head: overrides.head ?? { ref: 'feature/test', sha: 'abc123' },
		base: overrides.base ?? { ref: 'main' },
		user: overrides.user ?? { login: 'author' },
		merged_at: overrides.merged_at ?? null,
		updated_at: overrides.updated_at ?? new Date().toISOString(),
	};
	// Only include draft if explicitly provided (simulates API behavior where field may be absent)
	if ('draft' in overrides) {
		result.draft = overrides.draft;
	}
	return result;
}

/**
 * Create a mock PR review based on GitHub Pull Request Review API response.
 * Source: https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request
 */
function createMockReview(
	overrides: Partial<{
		id: number;
		state: string;
		body: string | null;
		html_url: string;
		user: { login: string } | null;
		submitted_at: string | null;
		commit_id: string;
	}> = {},
) {
	return {
		id: overrides.id ?? 100,
		state: overrides.state ?? 'APPROVED',
		body: overrides.body ?? 'LGTM',
		html_url: overrides.html_url ?? 'https://github.com/owner/repo/pull/42#pullrequestreview-100',
		user: overrides.user ?? { login: 'reviewer' },
		submitted_at: overrides.submitted_at ?? new Date().toISOString(),
		commit_id: overrides.commit_id ?? 'abc123',
	};
}

describe('pollPRReviewsForRepo', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFindFirst.mockResolvedValue(undefined);
		mockInsert.mockReturnValue({ values: mockValues });
		mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
	});

	describe('watermark filtering', () => {
		it('skips reviews older than watermark', async () => {
			const watermarkDate = new Date('2024-06-01T12:00:00Z');
			mockFindFirst.mockResolvedValueOnce({ watermark: watermarkDate });

			const oldReview = createMockReview({
				id: 100,
				submitted_at: '2024-05-15T10:00:00Z', // Before watermark
			});

			const reviewsMap = new Map([[42, [oldReview]]]);
			const octokit = createMockOctokit([createMockPR({ number: 42 })], reviewsMap);

			const result = await pollPRReviewsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			expect(result.total).toBe(0);
			expect(result.emitted).toBe(0);
			expect(dispatchAndRecord).not.toHaveBeenCalled();
		});

		it('emits reviews after watermark', async () => {
			const watermarkDate = new Date('2024-06-01T12:00:00Z');
			mockFindFirst.mockResolvedValueOnce({ watermark: watermarkDate });

			const newReview = createMockReview({
				id: 101,
				submitted_at: '2024-06-15T10:00:00Z', // After watermark
			});

			const reviewsMap = new Map([[42, [newReview]]]);
			const octokit = createMockOctokit([createMockPR({ number: 42 })], reviewsMap);

			const result = await pollPRReviewsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			expect(result.total).toBe(1);
			expect(result.emitted).toBe(1);
			expect(dispatchAndRecord).toHaveBeenCalledTimes(1);
		});
	});

	describe('watermark updates', () => {
		it('updates watermark after successful poll', async () => {
			const newReview = createMockReview({
				id: 101,
				submitted_at: '2024-06-15T10:00:00Z',
			});

			const reviewsMap = new Map([[42, [newReview]]]);
			const octokit = createMockOctokit([createMockPR({ number: 42 })], reviewsMap);

			await pollPRReviewsForRepo('p1', 'owner', 'repo', octokit, mockAdapter, mockTriggerRegistry);

			expect(mockInsert).toHaveBeenCalled();
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'p1',
					provider: 'github',
					resourceType: 'pr_reviews',
					resourceId: 'owner/repo',
				}),
			);
		});
	});

	describe('synthetic payload fields', () => {
		it('sets review.user.login in synthetic payload for loop protection', async () => {
			const newReview = createMockReview({
				id: 101,
				submitted_at: new Date(Date.now() + 60000).toISOString(), // Future to pass watermark
				user: { login: 'cascade-reviewer' },
			});

			const reviewsMap = new Map([[42, [newReview]]]);
			const octokit = createMockOctokit([createMockPR({ number: 42 })], reviewsMap);

			await pollPRReviewsForRepo('p1', 'owner', 'repo', octokit, mockAdapter, mockTriggerRegistry);

			expect(dispatchAndRecord).toHaveBeenCalledWith(
				'p1',
				'github',
				'pr_review',
				expect.any(String),
				expect.objectContaining({
					review: expect.objectContaining({
						user: { login: 'cascade-reviewer' },
					}),
					sender: { login: 'cascade-reviewer' },
				}),
				mockAdapter,
				mockTriggerRegistry,
			);
		});
	});

	describe('dedup key format', () => {
		it('uses correct dedup key format: github:{owner}/{repo}:pr_review:{pr_number}:{review_id}', async () => {
			const newReview = createMockReview({
				id: 12345,
				submitted_at: new Date(Date.now() + 60000).toISOString(),
			});

			const reviewsMap = new Map([[99, [newReview]]]);
			const octokit = createMockOctokit([createMockPR({ number: 99 })], reviewsMap);

			await pollPRReviewsForRepo('p1', 'owner', 'repo', octokit, mockAdapter, mockTriggerRegistry);

			const expectedDedupKey = buildPRReviewDedupKey('owner', 'repo', 99, 12345);
			expect(expectedDedupKey).toBe('github:owner/repo:pr_review:99:12345');

			expect(dispatchAndRecord).toHaveBeenCalledWith(
				'p1',
				'github',
				'pr_review',
				expectedDedupKey,
				expect.any(Object),
				mockAdapter,
				mockTriggerRegistry,
			);
		});
	});

	describe('ledger deduplication', () => {
		it('skips reviews already in ledger', async () => {
			const review1 = createMockReview({
				id: 100,
				submitted_at: new Date(Date.now() + 60000).toISOString(),
			});
			const review2 = createMockReview({
				id: 101,
				submitted_at: new Date(Date.now() + 60000).toISOString(),
			});

			const reviewsMap = new Map([[42, [review1, review2]]]);
			const octokit = createMockOctokit([createMockPR({ number: 42 })], reviewsMap);

			// Mark first review as already processed
			vi.mocked(batchCheckLedger).mockResolvedValueOnce(
				new Set(['github:owner/repo:pr_review:42:100']),
			);

			const result = await pollPRReviewsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			expect(result.total).toBe(2);
			expect(result.skipped).toBe(1);
			expect(result.emitted).toBe(1);
			expect(dispatchAndRecord).toHaveBeenCalledTimes(1);
		});
	});

	describe('listReviews API errors', () => {
		it('increments errors when listReviews fails, preventing watermark advance', async () => {
			const pr1 = createMockPR({ number: 41 });
			const pr2 = createMockPR({ number: 42 });

			const octokit = {
				pulls: {
					list: vi.fn().mockResolvedValue({ data: [pr1, pr2] }),
					listReviews: vi.fn().mockImplementation(({ pull_number }: { pull_number: number }) => {
						if (pull_number === 41) {
							// PR 41 fails
							return Promise.reject(new Error('API rate limit exceeded'));
						}
						// PR 42 has a review
						return Promise.resolve({
							data: [
								createMockReview({
									id: 200,
									submitted_at: new Date(Date.now() + 60000).toISOString(),
								}),
							],
						});
					}),
				},
			} as unknown as Parameters<typeof pollPRReviewsForRepo>[3];

			const result = await pollPRReviewsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			// Should have 1 error from the failed listReviews call
			expect(result.errors).toBe(1);
			// Should still have found and emitted the review from PR 42
			expect(result.total).toBe(1);
			expect(result.emitted).toBe(1);

			// Watermark should NOT be updated because errors > 0
			// mockInsert is called for watermark upsert
			expect(mockInsert).not.toHaveBeenCalled();
		});

		it('does NOT advance watermark when all listReviews calls fail (empty allReviews)', async () => {
			const pr1 = createMockPR({ number: 41 });
			const pr2 = createMockPR({ number: 42 });

			const octokit = {
				pulls: {
					list: vi.fn().mockResolvedValue({ data: [pr1, pr2] }),
					listReviews: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
				},
			} as unknown as Parameters<typeof pollPRReviewsForRepo>[3];

			const result = await pollPRReviewsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			// Both listReviews calls failed
			expect(result.errors).toBe(2);
			expect(result.total).toBe(0);
			expect(result.emitted).toBe(0);

			// Watermark should NOT be updated because errors > 0 (even though allReviews is empty)
			expect(mockInsert).not.toHaveBeenCalled();
		});
	});

	describe('stale PR optimization', () => {
		it('skips listReviews for PRs not updated since watermark', async () => {
			const watermarkDate = new Date('2024-06-01T12:00:00Z');
			mockFindFirst.mockResolvedValueOnce({ watermark: watermarkDate });

			// PR 41 was updated BEFORE watermark - should be skipped
			const stalePR = createMockPR({
				number: 41,
				updated_at: '2024-05-15T10:00:00Z',
			});
			// PR 42 was updated AFTER watermark - should be checked
			const recentPR = createMockPR({
				number: 42,
				updated_at: '2024-06-15T10:00:00Z',
			});

			const reviewsMap = new Map([
				[41, [createMockReview({ id: 100, submitted_at: '2024-06-02T10:00:00Z' })]],
				[42, [createMockReview({ id: 101, submitted_at: '2024-06-15T10:00:00Z' })]],
			]);

			const octokit = createMockOctokit([stalePR, recentPR], reviewsMap);

			const result = await pollPRReviewsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			// listReviews should only be called for PR 42 (recent), not PR 41 (stale)
			expect(octokit.pulls.listReviews).toHaveBeenCalledTimes(1);
			expect(octokit.pulls.listReviews).toHaveBeenCalledWith(
				expect.objectContaining({ pull_number: 42 }),
			);

			expect(result.total).toBe(1);
			expect(result.emitted).toBe(1);
		});
	});

	describe('PENDING reviews', () => {
		it('skips PENDING reviews', async () => {
			const pendingReview = createMockReview({
				id: 100,
				state: 'PENDING',
				submitted_at: new Date(Date.now() + 60000).toISOString(),
			});

			const reviewsMap = new Map([[42, [pendingReview]]]);
			const octokit = createMockOctokit([createMockPR({ number: 42 })], reviewsMap);

			const result = await pollPRReviewsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			expect(result.total).toBe(0);
			expect(dispatchAndRecord).not.toHaveBeenCalled();
		});
	});

	describe('open PR fetch failure', () => {
		it('returns errors >= 1 and empty openPRs when list fetch fails', async () => {
			const octokit = {
				pulls: {
					list: vi.fn().mockRejectedValue(new Error('GitHub API error')),
					listReviews: vi.fn(),
				},
			} as unknown as Parameters<typeof pollPRReviewsForRepo>[3];

			const result = await pollPRReviewsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			expect(result.errors).toBeGreaterThanOrEqual(1);
			expect(result.openPRs).toEqual([]);
		});
	});

	describe('openPRs draft field mapping', () => {
		it('maps draft: true from API response to openPRs item', async () => {
			const draftPR = createMockPR({ number: 42, draft: true });
			const octokit = createMockOctokit([draftPR], new Map());

			const result = await pollPRReviewsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			expect(result.openPRs).toHaveLength(1);
			expect(result.openPRs[0].draft).toBe(true);
		});

		it('defaults draft to false when undefined in API response', async () => {
			// API response without draft field
			const prWithoutDraft = createMockPR({ number: 42 });
			expect('draft' in prWithoutDraft).toBe(false);

			const octokit = createMockOctokit([prWithoutDraft], new Map());

			const result = await pollPRReviewsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			expect(result.openPRs).toHaveLength(1);
			expect(result.openPRs[0].draft).toBe(false);
		});

		it('returns openPRs even when no reviews are found', async () => {
			const pr = createMockPR({ number: 42 });
			const octokit = createMockOctokit([pr], new Map());

			const result = await pollPRReviewsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			expect(result.openPRs).toHaveLength(1);
			expect(result.openPRs[0].number).toBe(42);
		});
	});
});

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
	WATERMARK_OVERLAP_MS: 5000,
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
import { pollMergedPRsForRepo } from '../../../../../src/polling/providers/github/merged-pr-poller.js';
import { buildMergedPRDedupKey } from '../../../../../src/polling/providers/github/types.js';
import type { RouterPlatformAdapter } from '../../../../../src/router/platform-adapter.js';
import type { TriggerRegistry } from '../../../../../src/triggers/registry.js';

const mockAdapter = {
	type: 'github',
} as unknown as RouterPlatformAdapter;

const mockTriggerRegistry = {
	dispatch: vi.fn(),
} as unknown as TriggerRegistry;

function createMockOctokit(closedPRs: unknown[] = []) {
	return {
		pulls: {
			list: vi.fn().mockResolvedValue({ data: closedPRs }),
		},
	} as unknown as Parameters<typeof pollMergedPRsForRepo>[3];
}

function createMockPR(
	overrides: Partial<{
		number: number;
		title: string;
		body: string | null;
		state: string;
		html_url: string;
		head: { ref: string; sha: string };
		base: { ref: string };
		user: { login: string } | null;
		merged_at: string | null;
		updated_at: string;
	}> = {},
) {
	return {
		number: overrides.number ?? 42,
		title: overrides.title ?? 'Test PR',
		body: overrides.body ?? 'PR body',
		state: overrides.state ?? 'closed',
		html_url: overrides.html_url ?? 'https://github.com/owner/repo/pull/42',
		head: overrides.head ?? { ref: 'feature/test', sha: 'abc123' },
		base: overrides.base ?? { ref: 'main' },
		user: overrides.user ?? { login: 'author' },
		// Use 'merged_at' in overrides to allow explicit null
		merged_at: 'merged_at' in overrides ? overrides.merged_at : new Date().toISOString(),
		updated_at: overrides.updated_at ?? new Date().toISOString(),
	};
}

describe('pollMergedPRsForRepo', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFindFirst.mockResolvedValue(undefined);
		mockInsert.mockReturnValue({ values: mockValues });
		mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
	});

	describe('merged vs closed filtering', () => {
		it('emits only merged PRs (merged_at is set)', async () => {
			const mergedPR = createMockPR({
				number: 42,
				merged_at: new Date().toISOString(),
			});

			const octokit = createMockOctokit([mergedPR]);

			const result = await pollMergedPRsForRepo(
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

		it('skips closed-but-not-merged PRs (merged_at is null)', async () => {
			const closedNotMergedPR = createMockPR({
				number: 43,
				merged_at: null, // Closed but NOT merged
			});

			const octokit = createMockOctokit([closedNotMergedPR]);

			const result = await pollMergedPRsForRepo(
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

		it('correctly filters a mix of merged and closed-not-merged PRs', async () => {
			const mergedPR = createMockPR({
				number: 42,
				merged_at: new Date().toISOString(),
			});
			const closedNotMergedPR = createMockPR({
				number: 43,
				merged_at: null,
			});

			const octokit = createMockOctokit([mergedPR, closedNotMergedPR]);

			const result = await pollMergedPRsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			expect(result.total).toBe(1);
			expect(result.emitted).toBe(1);
		});
	});

	describe('watermark updates', () => {
		it('updates watermark after successful poll', async () => {
			const mergedPR = createMockPR({
				number: 42,
				merged_at: '2024-06-15T10:00:00Z',
			});

			const octokit = createMockOctokit([mergedPR]);

			await pollMergedPRsForRepo('p1', 'owner', 'repo', octokit, mockAdapter, mockTriggerRegistry);

			expect(mockInsert).toHaveBeenCalled();
			expect(mockValues).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: 'p1',
					provider: 'github',
					resourceType: 'merged_prs',
					resourceId: 'owner/repo',
				}),
			);
		});

		it('skips PRs merged before watermark', async () => {
			const watermarkDate = new Date('2024-06-01T12:00:00Z');
			mockFindFirst.mockResolvedValueOnce({ watermark: watermarkDate });

			const oldMergedPR = createMockPR({
				number: 42,
				merged_at: '2024-05-15T10:00:00Z', // Before watermark
			});

			const octokit = createMockOctokit([oldMergedPR]);

			const result = await pollMergedPRsForRepo(
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

	describe('synthetic payload fields', () => {
		it('sets pull_request.merged: true in synthetic payload', async () => {
			const mergedPR = createMockPR({
				number: 42,
				merged_at: new Date().toISOString(),
			});

			const octokit = createMockOctokit([mergedPR]);

			await pollMergedPRsForRepo('p1', 'owner', 'repo', octokit, mockAdapter, mockTriggerRegistry);

			expect(dispatchAndRecord).toHaveBeenCalledWith(
				'p1',
				'github',
				'merged_pr',
				expect.any(String),
				expect.objectContaining({
					action: 'closed',
					pull_request: expect.objectContaining({
						merged: true,
						state: 'closed',
					}),
				}),
				mockAdapter,
				mockTriggerRegistry,
			);
		});

		it('sets correct _eventType in synthetic payload', async () => {
			const mergedPR = createMockPR({
				number: 42,
				merged_at: new Date().toISOString(),
			});

			const octokit = createMockOctokit([mergedPR]);

			await pollMergedPRsForRepo('p1', 'owner', 'repo', octokit, mockAdapter, mockTriggerRegistry);

			expect(dispatchAndRecord).toHaveBeenCalledWith(
				'p1',
				'github',
				'merged_pr',
				expect.any(String),
				expect.objectContaining({
					_eventType: 'pull_request',
				}),
				mockAdapter,
				mockTriggerRegistry,
			);
		});
	});

	describe('dedup key format', () => {
		it('uses correct dedup key format: github:{owner}/{repo}:merged_pr:{pr_number}', async () => {
			const mergedPR = createMockPR({
				number: 99,
				merged_at: new Date().toISOString(),
			});

			const octokit = createMockOctokit([mergedPR]);

			await pollMergedPRsForRepo('p1', 'owner', 'repo', octokit, mockAdapter, mockTriggerRegistry);

			const expectedDedupKey = buildMergedPRDedupKey('owner', 'repo', 99);
			expect(expectedDedupKey).toBe('github:owner/repo:merged_pr:99');

			expect(dispatchAndRecord).toHaveBeenCalledWith(
				'p1',
				'github',
				'merged_pr',
				expectedDedupKey,
				expect.any(Object),
				mockAdapter,
				mockTriggerRegistry,
			);
		});
	});

	describe('ledger deduplication', () => {
		it('skips PRs already in ledger', async () => {
			const pr1 = createMockPR({ number: 42, merged_at: new Date().toISOString() });
			const pr2 = createMockPR({ number: 43, merged_at: new Date().toISOString() });

			const octokit = createMockOctokit([pr1, pr2]);

			// Mark first PR as already processed
			vi.mocked(batchCheckLedger).mockResolvedValueOnce(
				new Set(['github:owner/repo:merged_pr:42']),
			);

			const result = await pollMergedPRsForRepo(
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

	describe('watermark overlap race condition fix', () => {
		it('sets watermark to cycleStart minus overlap, not cycle end time', async () => {
			const mergedPR = createMockPR({
				number: 42,
				merged_at: new Date().toISOString(),
			});
			const octokit = createMockOctokit([mergedPR]);

			let capturedWatermark: Date | undefined;
			mockValues.mockImplementation((values: { watermark: Date }) => {
				capturedWatermark = values.watermark;
				return { onConflictDoUpdate: mockOnConflictDoUpdate };
			});

			const beforeCall = new Date();
			await pollMergedPRsForRepo('p1', 'owner', 'repo', octokit, mockAdapter, mockTriggerRegistry);

			expect(mockInsert).toHaveBeenCalled();
			expect(capturedWatermark).toBeDefined();

			// Watermark should be cycleStart - 5000ms (WATERMARK_OVERLAP_MS)
			// It should be BEFORE beforeCall (not at or after cycle end)
			const watermarkTime = capturedWatermark?.getTime() ?? 0;
			const beforeCallTime = beforeCall.getTime();

			expect(watermarkTime).toBeLessThan(beforeCallTime);
			expect(beforeCallTime - watermarkTime).toBeGreaterThanOrEqual(4900);
			expect(beforeCallTime - watermarkTime).toBeLessThan(10000);
		});

		it('no-merged-PRs path still advances watermark with overlap', async () => {
			// Return a closed PR that is NOT merged
			const closedNotMerged = createMockPR({
				number: 42,
				merged_at: null,
			});
			const octokit = createMockOctokit([closedNotMerged]);

			let capturedWatermark: Date | undefined;
			mockValues.mockImplementation((values: { watermark: Date }) => {
				capturedWatermark = values.watermark;
				return { onConflictDoUpdate: mockOnConflictDoUpdate };
			});

			const beforeCall = new Date();
			await pollMergedPRsForRepo('p1', 'owner', 'repo', octokit, mockAdapter, mockTriggerRegistry);

			expect(mockInsert).toHaveBeenCalled();
			expect(capturedWatermark).toBeDefined();

			const watermarkTime = capturedWatermark?.getTime() ?? 0;
			expect(watermarkTime).toBeLessThan(beforeCall.getTime());
		});

		it('re-seen merge in overlap window does not trigger pr-merged twice (ledger dedup)', async () => {
			const mergedPR = createMockPR({
				number: 42,
				merged_at: new Date().toISOString(),
			});
			const octokit = createMockOctokit([mergedPR]);

			// First call: PR is new, should be dispatched
			const result1 = await pollMergedPRsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			expect(result1.emitted).toBe(1);
			expect(dispatchAndRecord).toHaveBeenCalledTimes(1);

			// Second call: PR is in ledger (re-seen in overlap window), should be skipped
			vi.mocked(batchCheckLedger).mockResolvedValueOnce(
				new Set(['github:owner/repo:merged_pr:42']),
			);

			const result2 = await pollMergedPRsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			expect(result2.total).toBe(1);
			expect(result2.skipped).toBe(1);
			expect(result2.emitted).toBe(0);
			// dispatchAndRecord should not be called again
			expect(dispatchAndRecord).toHaveBeenCalledTimes(1);
		});

		it('errors > 0 prevents watermark advance', async () => {
			const mergedPR = createMockPR({
				number: 42,
				merged_at: new Date().toISOString(),
			});
			const octokit = createMockOctokit([mergedPR]);

			// Make dispatch fail
			vi.mocked(dispatchAndRecord).mockResolvedValueOnce({
				recorded: false,
				deferred: false,
				skipped: false,
				enqueued: false,
				error: new Error('Dispatch failed'),
			});

			const result = await pollMergedPRsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			expect(result.errors).toBe(1);
			expect(mockInsert).not.toHaveBeenCalled();
		});

		it('cold start uses 24-hour lookback, not overlap', async () => {
			mockFindFirst.mockResolvedValueOnce(undefined); // No watermark

			const recentMerge = createMockPR({
				number: 42,
				merged_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
			});
			const oldMerge = createMockPR({
				number: 43,
				merged_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 48 hours ago
			});

			const octokit = createMockOctokit([recentMerge, oldMerge]);

			const result = await pollMergedPRsForRepo(
				'p1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
			);

			// Only the recent merge should be picked up (within 24 hours)
			expect(result.total).toBe(1);
			expect(result.emitted).toBe(1);
		});

		it('synthetic payload contains fields needed for PRMergedTrigger (Jira transition, snapshot cleanup)', async () => {
			const mergedPR = createMockPR({
				number: 42,
				title: 'Add feature X',
				merged_at: new Date().toISOString(),
				head: { ref: 'feature/x', sha: 'abc123' },
				base: { ref: 'main' },
				user: { login: 'cascade-implementer' },
			});

			const octokit = createMockOctokit([mergedPR]);

			await pollMergedPRsForRepo('p1', 'owner', 'repo', octokit, mockAdapter, mockTriggerRegistry);

			// PRMergedTrigger needs: action='closed', pull_request.merged=true,
			// pull_request.number, pull_request.base.ref, repository.full_name
			expect(dispatchAndRecord).toHaveBeenCalledWith(
				'p1',
				'github',
				'merged_pr',
				expect.any(String),
				expect.objectContaining({
					action: 'closed',
					pull_request: expect.objectContaining({
						number: 42,
						merged: true,
						state: 'closed',
						title: 'Add feature X',
						head: expect.objectContaining({ ref: 'feature/x' }),
						base: expect.objectContaining({ ref: 'main' }),
						user: expect.objectContaining({ login: 'cascade-implementer' }),
					}),
					repository: expect.objectContaining({
						full_name: 'owner/repo',
					}),
				}),
				mockAdapter,
				mockTriggerRegistry,
			);
		});
	});
});

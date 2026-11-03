import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/polling/dispatch.js', () => ({
	batchCheckLedger: vi.fn().mockResolvedValue(new Set()),
	dispatchAndRecord: vi
		.fn()
		.mockResolvedValue({ recorded: true, deferred: false, skipped: false, enqueued: true }),
	batchRecordWithoutDispatch: vi.fn().mockResolvedValue(1),
}));

vi.mock('../../../../../src/router/work-item-lock.js', () => ({
	isWorkItemLocked: vi.fn().mockResolvedValue({ locked: false }),
}));

vi.mock('../../../../../src/triggers/github/utils.js', () => ({
	resolveWorkItemId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import {
	batchCheckLedger,
	batchRecordWithoutDispatch,
	dispatchAndRecord,
} from '../../../../../src/polling/dispatch.js';
import {
	pollPRConflictsForRepo,
	resetSettledHeadTracking,
} from '../../../../../src/polling/providers/github/pr-conflict-poller.js';
import type { RouterPlatformAdapter } from '../../../../../src/router/platform-adapter.js';
import { isWorkItemLocked } from '../../../../../src/router/work-item-lock.js';
import { resolveWorkItemId } from '../../../../../src/triggers/github/utils.js';
import type { TriggerRegistry } from '../../../../../src/triggers/registry.js';

const mockAdapter = {
	type: 'github',
} as unknown as RouterPlatformAdapter;

const mockTriggerRegistry = {
	dispatch: vi.fn(),
} as unknown as TriggerRegistry;

/**
 * Create a mock Octokit with configurable responses.
 */
function createMockOctokit(
	baseShas: Map<string, string> = new Map([['main', 'base-sha-123']]),
	prDetails: Map<number, { mergeable: boolean | null; mergeableState: string | null }> = new Map(),
) {
	return {
		git: {
			getRef: vi.fn().mockImplementation(({ ref }: { ref: string }) => {
				const branch = ref.replace('heads/', '');
				const sha = baseShas.get(branch);
				if (!sha) {
					return Promise.reject(new Error(`Branch ${branch} not found`));
				}
				return Promise.resolve({ data: { object: { sha } } });
			}),
		},
		pulls: {
			get: vi.fn().mockImplementation(({ pull_number }: { pull_number: number }) => {
				const details = prDetails.get(pull_number);
				if (!details) {
					return Promise.reject(new Error(`PR ${pull_number} not found`));
				}
				return Promise.resolve({
					data: {
						number: pull_number,
						title: `PR #${pull_number}`,
						body: null,
						state: 'open',
						html_url: `https://github.com/owner/repo/pull/${pull_number}`,
						head: { ref: 'feature', sha: `head-sha-${pull_number}` },
						base: { ref: 'main' },
						merged: false,
						mergeable: details.mergeable,
						mergeable_state: details.mergeableState,
						user: { login: 'author' },
					},
				});
			}),
		},
	} as unknown as Parameters<typeof pollPRConflictsForRepo>[3];
}

/**
 * Create a mock open PR (as returned by pulls.list).
 */
function createMockOpenPR(
	number: number,
	headSha = `head-sha-${number}`,
	baseRef = 'main',
	draft = false,
): Parameters<typeof pollPRConflictsForRepo>[6][0] {
	return {
		number,
		title: `PR #${number}`,
		body: null,
		state: 'open',
		draft,
		html_url: `https://github.com/owner/repo/pull/${number}`,
		head: { ref: 'feature', sha: headSha },
		base: { ref: baseRef },
		user: { login: 'author' },
		merged: false,
		merged_at: null,
		updated_at: new Date().toISOString(),
	};
}

// Cast mocks for type-safe access
const mockBatchCheckLedger = batchCheckLedger as ReturnType<typeof vi.fn>;
const mockDispatchAndRecord = dispatchAndRecord as ReturnType<typeof vi.fn>;
const mockBatchRecordWithoutDispatch = batchRecordWithoutDispatch as ReturnType<typeof vi.fn>;
const mockIsWorkItemLocked = isWorkItemLocked as ReturnType<typeof vi.fn>;
const mockResolveWorkItemId = resolveWorkItemId as ReturnType<typeof vi.fn>;

describe('pollPRConflictsForRepo', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetSettledHeadTracking(); // Clear settled-head tracking between tests
		mockBatchCheckLedger.mockResolvedValue(new Set());
		mockDispatchAndRecord.mockResolvedValue({
			recorded: true,
			deferred: false,
			skipped: false,
			enqueued: true,
		});
		mockBatchRecordWithoutDispatch.mockResolvedValue(1);
		mockIsWorkItemLocked.mockResolvedValue({ locked: false });
		mockResolveWorkItemId.mockResolvedValue(undefined); // Default: no work item linked
	});

	it('returns zero result for empty PR list', async () => {
		const octokit = createMockOctokit();

		const result = await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[],
		);

		expect(result).toEqual({ total: 0, emitted: 0, skipped: 0, errors: 0 });
		expect(mockBatchCheckLedger).not.toHaveBeenCalled();
	});

	it('skips PRs already in ledger', async () => {
		const pr1 = createMockOpenPR(1);
		const dedupKey = 'github:owner/repo:pr_conflict_check:1:head-sha-1:base-sha-123';
		mockBatchCheckLedger.mockResolvedValue(new Set([dedupKey]));

		const octokit = createMockOctokit();

		const result = await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1],
		);

		expect(result.skipped).toBe(1);
		expect(result.emitted).toBe(0);
		// Should not fetch PR details for PRs in ledger
		expect(octokit.pulls.get).not.toHaveBeenCalled();
	});

	it('fetches PR details for unchecked tuples', async () => {
		const pr1 = createMockOpenPR(1);
		const prDetails = new Map([[1, { mergeable: true, mergeableState: 'clean' }]]);
		const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

		const result = await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1],
		);

		expect(octokit.pulls.get).toHaveBeenCalledWith({
			owner: 'owner',
			repo: 'repo',
			pull_number: 1,
		});
		// Clean PR should be recorded but not emitted
		expect(result.emitted).toBe(0);
		expect(mockBatchRecordWithoutDispatch).toHaveBeenCalled();
	});

	it('dispatches event for dirty (conflicting) PR after head is settled', async () => {
		const pr1 = createMockOpenPR(1);
		const prDetails = new Map([[1, { mergeable: false, mergeableState: 'dirty' }]]);
		const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

		// Cycle 1: deferred (head not settled)
		await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1],
		);

		// Cycle 2: head settled, dispatches
		const result = await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1],
		);

		expect(result.emitted).toBe(1);
		expect(mockDispatchAndRecord).toHaveBeenCalledWith(
			'project-1',
			'github',
			'pr_conflict',
			'github:owner/repo:pr_conflict_check:1:head-sha-1:base-sha-123',
			expect.objectContaining({
				_eventType: 'pull_request',
				action: 'synchronize',
				number: 1,
			}),
			mockAdapter,
			mockTriggerRegistry,
		);
	});

	it('does not record when mergeable is null (retry next cycle)', async () => {
		const pr1 = createMockOpenPR(1);
		const prDetails = new Map([[1, { mergeable: null, mergeableState: null }]]);
		const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

		const result = await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1],
		);

		expect(result.skipped).toBe(1);
		expect(result.emitted).toBe(0);
		expect(mockDispatchAndRecord).not.toHaveBeenCalled();
		// Should not record - will retry next cycle (no call when nothing to record)
		expect(mockBatchRecordWithoutDispatch).not.toHaveBeenCalled();
	});

	it('does not record when mergeableState is unknown (retry next cycle)', async () => {
		const pr1 = createMockOpenPR(1);
		const prDetails = new Map([[1, { mergeable: true, mergeableState: 'unknown' }]]);
		const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

		const result = await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1],
		);

		expect(result.skipped).toBe(1);
		expect(mockDispatchAndRecord).not.toHaveBeenCalled();
	});

	it('records clean PRs as pr_conflict_checked in batch', async () => {
		const pr1 = createMockOpenPR(1);
		const pr2 = createMockOpenPR(2, 'head-sha-2');
		const prDetails = new Map([
			[1, { mergeable: true, mergeableState: 'clean' }],
			[2, { mergeable: true, mergeableState: 'clean' }],
		]);
		const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

		await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1, pr2],
		);

		expect(mockBatchRecordWithoutDispatch).toHaveBeenCalledWith('project-1', 'github', [
			{
				eventType: 'pr_conflict_checked',
				dedupKey: expect.stringContaining('pr_conflict_check:1'),
			},
			{
				eventType: 'pr_conflict_checked',
				dedupKey: expect.stringContaining('pr_conflict_check:2'),
			},
		]);
	});

	it('records conflict immediately, not batched (after head settled)', async () => {
		const pr1 = createMockOpenPR(1);
		const pr2 = createMockOpenPR(2, 'head-sha-2');
		const prDetails = new Map([
			[1, { mergeable: false, mergeableState: 'dirty' }],
			[2, { mergeable: true, mergeableState: 'clean' }],
		]);
		const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

		// Cycle 1: pr1 deferred (head not settled), pr2 recorded as clean
		await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1, pr2],
		);
		mockBatchRecordWithoutDispatch.mockClear();

		// Cycle 2: pr1 head settled, dispatches; pr2 in ledger
		mockBatchCheckLedger.mockResolvedValue(
			new Set(['github:owner/repo:pr_conflict_check:2:head-sha-2:base-sha-123']),
		);
		await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1, pr2],
		);

		// Conflict PR dispatched immediately via dispatchAndRecord
		expect(mockDispatchAndRecord).toHaveBeenCalledTimes(1);
		expect(mockDispatchAndRecord).toHaveBeenCalledWith(
			'project-1',
			'github',
			'pr_conflict',
			expect.stringContaining('pr_conflict_check:1'),
			expect.anything(),
			expect.anything(),
			expect.anything(),
		);

		// pr2 was in ledger, no batch record this cycle
		expect(mockBatchRecordWithoutDispatch).not.toHaveBeenCalled();
	});

	it('fetches base SHA once per distinct base branch', async () => {
		const pr1 = createMockOpenPR(1, 'head-sha-1', 'main');
		const pr2 = createMockOpenPR(2, 'head-sha-2', 'main');
		const pr3 = createMockOpenPR(3, 'head-sha-3', 'develop');

		const baseShas = new Map([
			['main', 'base-sha-main'],
			['develop', 'base-sha-develop'],
		]);
		const prDetails = new Map([
			[1, { mergeable: true, mergeableState: 'clean' }],
			[2, { mergeable: true, mergeableState: 'clean' }],
			[3, { mergeable: true, mergeableState: 'clean' }],
		]);
		const octokit = createMockOctokit(baseShas, prDetails);

		await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1, pr2, pr3],
		);

		// Should fetch each base branch only once
		expect(octokit.git.getRef).toHaveBeenCalledTimes(2);
		expect(octokit.git.getRef).toHaveBeenCalledWith({
			owner: 'owner',
			repo: 'repo',
			ref: 'heads/main',
		});
		expect(octokit.git.getRef).toHaveBeenCalledWith({
			owner: 'owner',
			repo: 'repo',
			ref: 'heads/develop',
		});
	});

	it('handles failed base SHA fetch gracefully', async () => {
		const pr1 = createMockOpenPR(1, 'head-sha-1', 'nonexistent');
		const octokit = createMockOctokit(new Map(), new Map());

		const result = await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1],
		);

		expect(result.errors).toBe(1);
		expect(octokit.pulls.get).not.toHaveBeenCalled();
	});

	it('handles failed PR details fetch gracefully', async () => {
		const pr1 = createMockOpenPR(1);
		const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), new Map());

		const result = await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1],
		);

		expect(result.errors).toBe(1);
		expect(result.emitted).toBe(0);
	});

	it('uses correct dedup key format (after head settled)', async () => {
		const pr1 = createMockOpenPR(42, 'abc123');
		const prDetails = new Map([[42, { mergeable: false, mergeableState: 'dirty' }]]);
		const octokit = createMockOctokit(new Map([['main', 'def456']]), prDetails);

		// Cycle 1: deferred
		await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1],
		);

		// Cycle 2: settled, dispatches
		await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[pr1],
		);

		expect(mockDispatchAndRecord).toHaveBeenCalledWith(
			'project-1',
			'github',
			'pr_conflict',
			'github:owner/repo:pr_conflict_check:42:abc123:def456',
			expect.anything(),
			expect.anything(),
			expect.anything(),
		);
	});

	it('preserves draft status in synthetic payload (after head settled)', async () => {
		const draftPR = createMockOpenPR(99, 'head-sha-99', 'main', true);
		const prDetails = new Map([[99, { mergeable: false, mergeableState: 'dirty' }]]);
		const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

		// Cycle 1: deferred
		await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[draftPR],
		);

		// Cycle 2: settled, dispatches
		await pollPRConflictsForRepo(
			'project-1',
			'owner',
			'repo',
			octokit,
			mockAdapter,
			mockTriggerRegistry,
			[draftPR],
		);

		expect(mockDispatchAndRecord).toHaveBeenCalledWith(
			'project-1',
			'github',
			'pr_conflict',
			expect.any(String),
			expect.objectContaining({
				pull_request: expect.objectContaining({
					draft: true,
				}),
			}),
			expect.anything(),
			expect.anything(),
		);
	});

	describe('settled-head check', () => {
		it('defers dispatch on first cycle seeing a dirty PR (head not settled)', async () => {
			const pr1 = createMockOpenPR(1);
			const prDetails = new Map([[1, { mergeable: false, mergeableState: 'dirty' }]]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			const result = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			// First time seeing PR: deferred, not dispatched
			expect(result.skipped).toBe(1);
			expect(result.emitted).toBe(0);
			expect(mockDispatchAndRecord).not.toHaveBeenCalled();
			// No ledger write either
			expect(mockBatchRecordWithoutDispatch).not.toHaveBeenCalled();
		});

		it('dispatches on second cycle when head SHA is unchanged (settled)', async () => {
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			const prDetails = new Map([[1, { mergeable: false, mergeableState: 'dirty' }]]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			// Cycle 1: deferred
			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);
			expect(mockDispatchAndRecord).not.toHaveBeenCalled();

			// Cycle 2: same head SHA, should dispatch
			const result2 = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			expect(result2.emitted).toBe(1);
			expect(mockDispatchAndRecord).toHaveBeenCalledTimes(1);
		});

		it('defers again when head SHA changes between cycles', async () => {
			const prDetails = new Map([[1, { mergeable: false, mergeableState: 'dirty' }]]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			// Cycle 1: head-sha-A
			const pr1A = createMockOpenPR(1, 'head-sha-A');
			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1A],
			);
			expect(mockDispatchAndRecord).not.toHaveBeenCalled();

			// Cycle 2: head changed to head-sha-B - deferred again
			const pr1B = createMockOpenPR(1, 'head-sha-B');
			mockBatchCheckLedger.mockResolvedValue(new Set()); // Reset ledger mock
			const result2 = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1B],
			);

			expect(result2.skipped).toBe(1);
			expect(result2.emitted).toBe(0);
			expect(mockDispatchAndRecord).not.toHaveBeenCalled();

			// Cycle 3: same head-sha-B - now dispatches
			const result3 = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1B],
			);

			expect(result3.emitted).toBe(1);
			expect(mockDispatchAndRecord).toHaveBeenCalledTimes(1);
		});

		it('dispatches in cycle 2 when PR was unknown (null mergeable) in cycle 1 with same head', async () => {
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), new Map());

			// Cycle 1: mergeable state unknown (API returns null)
			(octokit.pulls.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				data: {
					number: 1,
					mergeable: null,
					mergeable_state: 'unknown',
				},
			});

			const result1 = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			expect(result1.skipped).toBe(1);
			expect(mockDispatchAndRecord).not.toHaveBeenCalled();

			// Cycle 2: same head, now dirty - should dispatch (head was tracked in cycle 1)
			(octokit.pulls.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				data: {
					number: 1,
					mergeable: false,
					mergeable_state: 'dirty',
				},
			});

			const result2 = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			expect(result2.emitted).toBe(1);
			expect(mockDispatchAndRecord).toHaveBeenCalledTimes(1);
		});

		it('cleans up tracking when PR is no longer in openPRs', async () => {
			const prDetails = new Map([[1, { mergeable: false, mergeableState: 'dirty' }]]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			// Cycle 1: PR 1 is open
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			// Cycle 2: PR 1 is closed (not in openPRs), PR 2 is open
			const pr2 = createMockOpenPR(2, 'head-sha-2');
			prDetails.set(2, { mergeable: true, mergeableState: 'clean' });
			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr2],
			);

			// Cycle 3: PR 1 reopened with same head - should defer (tracking was cleaned)
			prDetails.set(1, { mergeable: false, mergeableState: 'dirty' });
			mockBatchCheckLedger.mockResolvedValue(new Set()); // Fresh ledger
			vi.mocked(mockDispatchAndRecord).mockClear();
			const result3 = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			// Should defer because tracking was cleared
			expect(result3.skipped).toBe(1);
			expect(result3.emitted).toBe(0);
			expect(mockDispatchAndRecord).not.toHaveBeenCalled();
		});

		it('tracks clean PRs for future dirty checks', async () => {
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), new Map());

			// Cycle 1: PR is clean
			(octokit.pulls.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				data: {
					number: 1,
					mergeable: true,
					mergeable_state: 'clean',
				},
			});

			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			// Cycle 2: same head, now dirty - should dispatch (was tracked while clean)
			mockBatchCheckLedger.mockResolvedValue(new Set()); // Fresh ledger check
			(octokit.pulls.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				data: {
					number: 1,
					mergeable: false,
					mergeable_state: 'dirty',
				},
			});

			const result2 = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			expect(result2.emitted).toBe(1);
			expect(mockDispatchAndRecord).toHaveBeenCalledTimes(1);
		});

		it('resetSettledHeadTracking clears all tracking', async () => {
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			const prDetails = new Map([[1, { mergeable: false, mergeableState: 'dirty' }]]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			// Cycle 1: deferred
			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			// Reset tracking
			resetSettledHeadTracking();

			// Cycle 2: should defer again (tracking cleared)
			const result2 = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			expect(result2.skipped).toBe(1);
			expect(result2.emitted).toBe(0);
			expect(mockDispatchAndRecord).not.toHaveBeenCalled();
		});

		it('resetSettledHeadTracking can clear specific PR', async () => {
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			const pr2 = createMockOpenPR(2, 'head-sha-2');
			const prDetails = new Map([
				[1, { mergeable: false, mergeableState: 'dirty' }],
				[2, { mergeable: false, mergeableState: 'dirty' }],
			]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			// Cycle 1: both deferred
			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1, pr2],
			);

			// Reset only PR 1 for project-1
			resetSettledHeadTracking('project-1', 'owner/repo', 1);

			// Cycle 2: PR 1 defers, PR 2 dispatches
			const result2 = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1, pr2],
			);

			// PR 1 skipped (tracking cleared), PR 2 emitted (tracking intact)
			expect(result2.skipped).toBe(1);
			expect(result2.emitted).toBe(1);
			expect(mockDispatchAndRecord).toHaveBeenCalledTimes(1);
			expect(mockDispatchAndRecord).toHaveBeenCalledWith(
				'project-1',
				'github',
				'pr_conflict',
				expect.stringContaining('pr_conflict_check:2'),
				expect.anything(),
				expect.anything(),
				expect.anything(),
			);
		});

		it('two projects sharing same repo do not share settled state', async () => {
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			const prDetails = new Map([[1, { mergeable: false, mergeableState: 'dirty' }]]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			// Cycle 1: Project A sees PR 1, defers
			await pollPRConflictsForRepo(
				'project-A',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);
			expect(mockDispatchAndRecord).not.toHaveBeenCalled();

			// Cycle 1 (continued): Project B sees same PR 1 with same head
			// Should ALSO defer (not reuse Project A's tracking)
			const resultB = await pollPRConflictsForRepo(
				'project-B',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			expect(resultB.skipped).toBe(1);
			expect(resultB.emitted).toBe(0);
			expect(mockDispatchAndRecord).not.toHaveBeenCalled();

			// Cycle 2: Both projects see settled head, both dispatch
			mockBatchCheckLedger.mockResolvedValue(new Set()); // Fresh ledger
			await pollPRConflictsForRepo(
				'project-A',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);
			expect(mockDispatchAndRecord).toHaveBeenCalledTimes(1);

			await pollPRConflictsForRepo(
				'project-B',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);
			expect(mockDispatchAndRecord).toHaveBeenCalledTimes(2);
		});

		it('cleanup for project A does not remove project B entries', async () => {
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			const prDetails = new Map([[1, { mergeable: false, mergeableState: 'dirty' }]]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			// Cycle 1: Both projects see PR 1
			await pollPRConflictsForRepo(
				'project-A',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);
			await pollPRConflictsForRepo(
				'project-B',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			// Cycle 2: Project A has no open PRs (triggers cleanup)
			// Project B still has PR 1
			await pollPRConflictsForRepo(
				'project-A',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[], // No open PRs for project A
			);

			// Project B's cycle 2: should dispatch (its tracking is intact)
			mockBatchCheckLedger.mockResolvedValue(new Set());
			const resultB = await pollPRConflictsForRepo(
				'project-B',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			expect(resultB.emitted).toBe(1);
			expect(mockDispatchAndRecord).toHaveBeenCalledTimes(1);
		});
	});

	describe('lock pre-check', () => {
		it('skips dispatch when work item is locked (no trigger evaluation, no ledger write)', async () => {
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			const prDetails = new Map([[1, { mergeable: false, mergeableState: 'dirty' }]]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			// Setup: work item linked and locked
			mockResolveWorkItemId.mockResolvedValue('KAN-63');
			mockIsWorkItemLocked.mockResolvedValue({ locked: true, reason: 'active run exists' });

			// Cycle 1: settle the head
			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			// Cycle 2: settled, but locked
			const result = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			expect(result.skipped).toBe(1);
			expect(result.emitted).toBe(0);
			expect(mockDispatchAndRecord).not.toHaveBeenCalled();
			expect(mockBatchRecordWithoutDispatch).not.toHaveBeenCalled();
			expect(mockIsWorkItemLocked).toHaveBeenCalledWith('project-1', 'KAN-63', 'resolve-conflicts');
		});

		it('dispatches normally when no work item is linked (no lock protection)', async () => {
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			const prDetails = new Map([[1, { mergeable: false, mergeableState: 'dirty' }]]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			// No work item linked
			mockResolveWorkItemId.mockResolvedValue(undefined);

			// Cycle 1: settle the head
			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			// Cycle 2: settled, no work item - dispatches
			const result = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			expect(result.emitted).toBe(1);
			expect(mockDispatchAndRecord).toHaveBeenCalledTimes(1);
			// Lock check should not be called when no work item
			expect(mockIsWorkItemLocked).not.toHaveBeenCalled();
		});

		it('dispatches when lock released in next cycle', async () => {
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			const prDetails = new Map([[1, { mergeable: false, mergeableState: 'dirty' }]]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			mockResolveWorkItemId.mockResolvedValue('KAN-63');

			// Cycle 1: settle the head
			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			// Cycle 2: settled but locked
			mockIsWorkItemLocked.mockResolvedValue({ locked: true, reason: 'active run' });
			const result2 = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);
			expect(result2.skipped).toBe(1);
			expect(mockDispatchAndRecord).not.toHaveBeenCalled();

			// Cycle 3: lock released
			mockIsWorkItemLocked.mockResolvedValue({ locked: false });
			mockBatchCheckLedger.mockResolvedValue(new Set()); // Fresh ledger
			const result3 = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			expect(result3.emitted).toBe(1);
			expect(mockDispatchAndRecord).toHaveBeenCalledTimes(1);
		});

		it('clean and unsettled PRs never call the lock check', async () => {
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			const prDetails = new Map([[1, { mergeable: true, mergeableState: 'clean' }]]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			mockResolveWorkItemId.mockResolvedValue('KAN-63');

			// Cycle 1: clean PR
			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			// Lock check not called for clean PRs
			expect(mockIsWorkItemLocked).not.toHaveBeenCalled();
			expect(mockResolveWorkItemId).not.toHaveBeenCalled();

			// Reset mocks
			vi.clearAllMocks();
			mockResolveWorkItemId.mockResolvedValue('KAN-63');

			// Cycle 2: dirty but head changed (unsettled)
			prDetails.set(1, { mergeable: false, mergeableState: 'dirty' });
			const pr1Changed = createMockOpenPR(1, 'head-sha-2'); // Different head
			mockBatchCheckLedger.mockResolvedValue(new Set());

			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1Changed],
			);

			// Lock check not called for unsettled PRs
			expect(mockIsWorkItemLocked).not.toHaveBeenCalled();
			expect(mockResolveWorkItemId).not.toHaveBeenCalled();
		});

		it('counts error and skips when resolveWorkItemId throws (fail-closed)', async () => {
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			const prDetails = new Map([[1, { mergeable: false, mergeableState: 'dirty' }]]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			// Cycle 1: settle the head
			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			// Cycle 2: resolveWorkItemId throws
			mockResolveWorkItemId.mockRejectedValue(new Error('DB connection failed'));

			const result = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			expect(result.errors).toBe(1);
			expect(result.emitted).toBe(0);
			expect(mockDispatchAndRecord).not.toHaveBeenCalled();
			expect(mockBatchRecordWithoutDispatch).not.toHaveBeenCalled();
		});

		it('counts error and skips when isWorkItemLocked throws (fail-closed)', async () => {
			const pr1 = createMockOpenPR(1, 'head-sha-1');
			const prDetails = new Map([[1, { mergeable: false, mergeableState: 'dirty' }]]);
			const octokit = createMockOctokit(new Map([['main', 'base-sha-123']]), prDetails);

			mockResolveWorkItemId.mockResolvedValue('KAN-63');

			// Cycle 1: settle the head
			await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			// Cycle 2: isWorkItemLocked throws
			mockIsWorkItemLocked.mockRejectedValue(new Error('Redis connection failed'));

			const result = await pollPRConflictsForRepo(
				'project-1',
				'owner',
				'repo',
				octokit,
				mockAdapter,
				mockTriggerRegistry,
				[pr1],
			);

			expect(result.errors).toBe(1);
			expect(result.emitted).toBe(0);
			expect(mockDispatchAndRecord).not.toHaveBeenCalled();
			expect(mockBatchRecordWithoutDispatch).not.toHaveBeenCalled();
		});
	});
});

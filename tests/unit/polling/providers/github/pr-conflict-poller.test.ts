import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/polling/dispatch.js', () => ({
	batchCheckLedger: vi.fn().mockResolvedValue(new Set()),
	dispatchAndRecord: vi
		.fn()
		.mockResolvedValue({ recorded: true, deferred: false, skipped: false, enqueued: true }),
	batchRecordWithoutDispatch: vi.fn().mockResolvedValue(1),
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
import { pollPRConflictsForRepo } from '../../../../../src/polling/providers/github/pr-conflict-poller.js';
import type { RouterPlatformAdapter } from '../../../../../src/router/platform-adapter.js';
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
): Parameters<typeof pollPRConflictsForRepo>[6][0] {
	return {
		number,
		title: `PR #${number}`,
		body: null,
		state: 'open',
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

describe('pollPRConflictsForRepo', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockBatchCheckLedger.mockResolvedValue(new Set());
		mockDispatchAndRecord.mockResolvedValue({
			recorded: true,
			deferred: false,
			skipped: false,
			enqueued: true,
		});
		mockBatchRecordWithoutDispatch.mockResolvedValue(1);
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

	it('dispatches event for dirty (conflicting) PR', async () => {
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

	it('records conflict immediately, not batched', async () => {
		const pr1 = createMockOpenPR(1);
		const pr2 = createMockOpenPR(2, 'head-sha-2');
		const prDetails = new Map([
			[1, { mergeable: false, mergeableState: 'dirty' }],
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

		// Clean PR recorded in batch (not via dispatchAndRecord)
		expect(mockBatchRecordWithoutDispatch).toHaveBeenCalledWith('project-1', 'github', [
			{
				eventType: 'pr_conflict_checked',
				dedupKey: expect.stringContaining('pr_conflict_check:2'),
			},
		]);
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

	it('uses correct dedup key format', async () => {
		const pr1 = createMockOpenPR(42, 'abc123');
		const prDetails = new Map([[42, { mergeable: false, mergeableState: 'dirty' }]]);
		const octokit = createMockOctokit(new Map([['main', 'def456']]), prDetails);

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
});

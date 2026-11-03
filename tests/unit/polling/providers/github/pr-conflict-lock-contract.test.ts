/**
 * Contract test: lock pre-check uses the same key as real dispatch.
 *
 * This test verifies that the poller's lock pre-check and the real
 * checkDispatchLocks use identical key derivation, preventing drift.
 * The key logic is NOT mocked - this is a contract test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock only the DB/Redis layers, NOT the key derivation logic
vi.mock('../../../../../src/db/repositories/runsRepository.js', () => ({
	countActiveRuns: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../../../../src/router/config.js', () => ({
	routerConfig: {
		workerTimeoutMs: 30 * 60 * 1000,
	},
}));

vi.mock('../../../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

vi.mock('../../../../../src/router/lock-state-classifier.js', () => ({
	classifyLockState: vi.fn().mockResolvedValue('active'),
}));

vi.mock('../../../../../src/router/agent-type-lock.js', () => ({
	checkAgentTypeConcurrency: vi.fn().mockResolvedValue({ blocked: false }),
	markAgentTypeEnqueued: vi.fn(),
	markRecentlyDispatched: vi.fn(),
}));

import { countActiveRuns } from '../../../../../src/db/repositories/runsRepository.js';
import { checkDispatchLocks } from '../../../../../src/router/webhook-dispatch-locks.js';
import {
	clearAllWorkItemLocks,
	isWorkItemLocked,
	markWorkItemEnqueued,
} from '../../../../../src/router/work-item-lock.js';
import { buildResolveConflictsResult } from '../../../../../src/triggers/github/result-builders.js';
import type { TriggerResult } from '../../../../../src/types/index.js';

const mockCountActiveRuns = countActiveRuns as ReturnType<typeof vi.fn>;

describe('lock pre-check contract', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearAllWorkItemLocks();
		mockCountActiveRuns.mockResolvedValue(0);
	});

	it('pre-check key matches real dispatch key for resolve-conflicts', async () => {
		const workItemId = 'KAN-63';
		const projectId = 'project-1';

		// Build result the same way the trigger does
		const result = buildResolveConflictsResult({
			prNumber: 42,
			prDetails: {
				number: 42,
				title: 'Test PR',
				htmlUrl: 'https://github.com/owner/repo/pull/42',
				headRef: 'feature/test',
				headSha: 'abc123',
				baseRef: 'main',
				merged: false,
			},
			repoFullName: 'owner/repo',
			headSha: 'abc123',
			workItemId,
		});

		// Verify the result has workItemId set correctly
		expect(result.workItemId).toBe(workItemId);
		expect(result.agentType).toBe('resolve-conflicts');

		// Pre-check uses isWorkItemLocked directly with workItemId
		// (effectiveLockKey = result.lockKey ?? result.workItemId = workItemId)
		const preCheckResult = await isWorkItemLocked(projectId, workItemId, 'resolve-conflicts');
		expect(preCheckResult.locked).toBe(false);

		// Mark work item as locked (simulating an active run)
		markWorkItemEnqueued(projectId, workItemId, 'resolve-conflicts');

		// Now pre-check should see it as locked
		const preCheckLocked = await isWorkItemLocked(projectId, workItemId, 'resolve-conflicts');
		expect(preCheckLocked.locked).toBe(true);

		// checkDispatchLocks should ALSO see it as locked (same key)
		const dispatchLockCheck = await checkDispatchLocks({
			adapterType: 'github',
			projectId,
			result: result as TriggerResult & { agentType: string },
		});
		expect(dispatchLockCheck.blocked).toBe(true);
	});

	it('pre-check and dispatch both allow when no lock exists', async () => {
		const workItemId = 'KAN-99';
		const projectId = 'project-2';

		const result = buildResolveConflictsResult({
			prNumber: 99,
			prDetails: {
				number: 99,
				title: 'Another PR',
				htmlUrl: 'https://github.com/owner/repo/pull/99',
				headRef: 'feature/other',
				headSha: 'def456',
				baseRef: 'main',
				merged: false,
			},
			repoFullName: 'owner/repo',
			headSha: 'def456',
			workItemId,
		});

		// Pre-check: not locked
		const preCheckResult = await isWorkItemLocked(projectId, workItemId, 'resolve-conflicts');
		expect(preCheckResult.locked).toBe(false);

		// checkDispatchLocks: not blocked
		const dispatchLockCheck = await checkDispatchLocks({
			adapterType: 'github',
			projectId,
			result: result as TriggerResult & { agentType: string },
		});
		expect(dispatchLockCheck.blocked).toBe(false);
	});

	it('different agent types do not block each other', async () => {
		const workItemId = 'KAN-100';
		const projectId = 'project-3';

		// Lock for 'review' agent
		markWorkItemEnqueued(projectId, workItemId, 'review');

		// Pre-check for 'resolve-conflicts' should NOT be blocked
		const preCheckResult = await isWorkItemLocked(projectId, workItemId, 'resolve-conflicts');
		expect(preCheckResult.locked).toBe(false);
	});
});

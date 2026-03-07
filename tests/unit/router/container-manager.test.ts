import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — vi.hoisted creates variables before vi.mock factories run
// ---------------------------------------------------------------------------

const { mockDockerCreateContainer, mockDockerGetContainer } = vi.hoisted(() => ({
	mockDockerCreateContainer: vi.fn(),
	mockDockerGetContainer: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		createContainer: mockDockerCreateContainer,
		getContainer: mockDockerGetContainer,
	})),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

vi.mock('../../../src/config/provider.js', () => ({
	findProjectByRepo: vi.fn(),
	getAllProjectCredentials: vi.fn(),
}));

const mockFailOrphanedRun = vi.fn().mockResolvedValue(null);
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	failOrphanedRun: (...args: unknown[]) => mockFailOrphanedRun(...args),
}));

vi.mock('../../../src/config/configCache.js', () => ({
	configCache: {
		getConfig: vi.fn().mockReturnValue(null),
		getProjectByBoardId: vi.fn().mockReturnValue(null),
		getProjectByRepo: vi.fn().mockReturnValue(null),
		setConfig: vi.fn(),
		setProjectByBoardId: vi.fn(),
		setProjectByRepo: vi.fn(),
		invalidate: vi.fn(),
	},
}));

vi.mock('../../../src/router/notifications.js', () => ({
	notifyTimeout: vi.fn().mockResolvedValue(undefined),
}));

const mockClearWorkItemEnqueued = vi.fn();
const mockClearAllWorkItemLocks = vi.fn();
vi.mock('../../../src/router/work-item-lock.js', () => ({
	clearWorkItemEnqueued: (...args: unknown[]) => mockClearWorkItemEnqueued(...args),
	clearAllWorkItemLocks: (...args: unknown[]) => mockClearAllWorkItemLocks(...args),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		redisUrl: 'redis://localhost:6379',
		maxWorkers: 3,
		workerImage: 'test-worker:latest',
		workerMemoryMb: 512,
		workerTimeoutMs: 5000,
		dockerNetwork: 'test-network',
	},
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { findProjectByRepo, getAllProjectCredentials } from '../../../src/config/provider.js';
import {
	buildWorkerEnv,
	cleanupWorker,
	detachAll,
	extractProjectIdFromJob,
	getActiveWorkerCount,
	getActiveWorkers,
	killWorker,
	spawnWorker,
} from '../../../src/router/container-manager.js';
import { notifyTimeout } from '../../../src/router/notifications.js';
import type { CascadeJob } from '../../../src/router/queue.js';

const mockFindProjectByRepo = vi.mocked(findProjectByRepo);
const mockGetAllProjectCredentials = vi.mocked(getAllProjectCredentials);
const mockNotifyTimeout = vi.mocked(notifyTimeout);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<{ id: string; data: CascadeJob }> = {}) {
	return {
		id: overrides.id ?? 'job-1',
		data: overrides.data ?? ({ type: 'trello', projectId: 'proj-1' } as CascadeJob),
	};
}

function setupMockContainer(exitCode = 0) {
	let resolveWait!: (v: { StatusCode: number }) => void;
	const waitPromise = new Promise<{ StatusCode: number }>((res) => {
		resolveWait = res;
	});

	const container = {
		id: 'container-abc123def456',
		start: vi.fn().mockResolvedValue(undefined),
		wait: vi.fn().mockReturnValue(waitPromise),
		logs: vi.fn().mockResolvedValue(Buffer.from('')),
		stop: vi.fn().mockResolvedValue(undefined),
	};

	mockDockerCreateContainer.mockResolvedValue(container);
	mockDockerGetContainer.mockReturnValue(container);

	return {
		container,
		resolveWait: (code = exitCode) => resolveWait({ StatusCode: code }),
	};
}

// ---------------------------------------------------------------------------
// extractProjectIdFromJob
// ---------------------------------------------------------------------------

describe('extractProjectIdFromJob', () => {
	it('returns projectId for trello jobs', async () => {
		const job = { type: 'trello', projectId: 'proj-trello' } as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBe('proj-trello');
	});

	it('returns projectId for jira jobs', async () => {
		const job = { type: 'jira', projectId: 'proj-jira' } as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBe('proj-jira');
	});

	it('returns projectId resolved from repo for github jobs', async () => {
		const job = { type: 'github', repoFullName: 'owner/repo' } as CascadeJob;
		mockFindProjectByRepo.mockResolvedValue({ id: 'proj-gh' } as never);
		expect(await extractProjectIdFromJob(job)).toBe('proj-gh');
	});

	it('returns null for github jobs with no repoFullName', async () => {
		const job = { type: 'github' } as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBeNull();
	});

	it('returns projectId for manual-run jobs', async () => {
		const job = { type: 'manual-run', projectId: 'proj-m' } as unknown as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBe('proj-m');
	});

	it('returns projectId for retry-run jobs', async () => {
		const job = { type: 'retry-run', projectId: 'proj-r' } as unknown as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBe('proj-r');
	});

	it('returns null for unknown job types', async () => {
		const job = { type: 'unknown' } as unknown as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// buildWorkerEnv
// ---------------------------------------------------------------------------

describe('buildWorkerEnv', () => {
	beforeEach(() => {
		mockGetAllProjectCredentials.mockResolvedValue({ GITHUB_TOKEN: 'ghp_test' });
	});

	it('includes JOB_ID, JOB_TYPE, and JOB_DATA', async () => {
		const job = makeJob();
		const env = await buildWorkerEnv(job as never);
		expect(env).toContain('JOB_ID=job-1');
		expect(env).toContain('JOB_TYPE=trello');
		expect(env.some((e) => e.startsWith('JOB_DATA='))).toBe(true);
	});

	it('includes project credentials and CASCADE_CREDENTIAL_KEYS', async () => {
		const env = await buildWorkerEnv(makeJob() as never);
		expect(env).toContain('GITHUB_TOKEN=ghp_test');
		expect(env).toContain('CASCADE_CREDENTIAL_KEYS=GITHUB_TOKEN');
	});

	it('skips credential env vars if credential resolution fails', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockRejectedValue(new Error('DB error'));
		const env = await buildWorkerEnv(makeJob() as never);
		expect(env.some((e) => e.startsWith('CASCADE_CREDENTIAL_KEYS='))).toBe(false);
		warnSpy.mockRestore();
	});

	it('forwards SENTRY_DSN when set', async () => {
		process.env.SENTRY_DSN = 'https://sentry.example.com/1';
		const env = await buildWorkerEnv(makeJob() as never);
		expect(env).toContain('SENTRY_DSN=https://sentry.example.com/1');
		process.env.SENTRY_DSN = undefined;
	});
});

// ---------------------------------------------------------------------------
// spawnWorker / getActiveWorkerCount / getActiveWorkers
// ---------------------------------------------------------------------------

describe('spawnWorker', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockResolvedValue({});
		detachAll();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		detachAll();
	});

	it('creates and starts a container', async () => {
		const { container, resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		expect(mockDockerCreateContainer).toHaveBeenCalledWith(
			expect.objectContaining({
				Image: 'test-worker:latest',
				name: 'cascade-worker-job-1',
			}),
		);
		expect(container.start).toHaveBeenCalled();

		resolveWait();
	});

	it('increments active worker count after spawn', async () => {
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob({ id: 'job-cnt' }) as never);

		expect(getActiveWorkerCount()).toBeGreaterThan(0);

		resolveWait();
	});

	it('cleans up worker after container exits', async () => {
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob({ id: 'job-exit' }) as never);
		expect(getActiveWorkerCount()).toBeGreaterThanOrEqual(1);

		resolveWait(0);
		// Let microtasks flush
		await new Promise((r) => setTimeout(r, 10));

		const workers = getActiveWorkers();
		expect(workers.find((w) => w.jobId === 'job-exit')).toBeUndefined();
	});

	it('throws and does not track worker if container creation fails', async () => {
		mockDockerCreateContainer.mockRejectedValue(new Error('Docker unavailable'));
		const countBefore = getActiveWorkerCount();

		await expect(spawnWorker(makeJob({ id: 'job-fail' }) as never)).rejects.toThrow(
			'Docker unavailable',
		);

		expect(getActiveWorkerCount()).toBe(countBefore);
	});
});

// ---------------------------------------------------------------------------
// killWorker
// ---------------------------------------------------------------------------

describe('killWorker', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockResolvedValue({});
		mockNotifyTimeout.mockResolvedValue(undefined);
		detachAll();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		detachAll();
	});

	it('is a no-op for an unknown jobId', async () => {
		await expect(killWorker('nonexistent')).resolves.toBeUndefined();
		expect(mockDockerGetContainer).not.toHaveBeenCalled();
	});

	it('stops the container and sends timeout notification', async () => {
		const { container, resolveWait } = setupMockContainer();

		await spawnWorker(makeJob({ id: 'job-kill' }) as never);
		await killWorker('job-kill');

		expect(container.stop).toHaveBeenCalledWith({ t: 15 });
		expect(mockNotifyTimeout).toHaveBeenCalled();

		resolveWait();
	});

	it('still sends notification even if container stop fails', async () => {
		const { container, resolveWait } = setupMockContainer();
		container.stop.mockRejectedValue(new Error('already stopped'));

		await spawnWorker(makeJob({ id: 'job-already-stopped' }) as never);
		await killWorker('job-already-stopped');

		expect(mockNotifyTimeout).toHaveBeenCalled();

		resolveWait();
	});

	it('removes worker from tracking after kill', async () => {
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob({ id: 'job-rm' }) as never);
		expect(getActiveWorkers().find((w) => w.jobId === 'job-rm')).toBeDefined();

		await killWorker('job-rm');
		expect(getActiveWorkers().find((w) => w.jobId === 'job-rm')).toBeUndefined();

		resolveWait();
	});
});

// ---------------------------------------------------------------------------
// cleanupWorker
// ---------------------------------------------------------------------------

describe('cleanupWorker', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		mockFailOrphanedRun.mockClear();
		detachAll();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		detachAll();
	});

	it('is a no-op for an unknown jobId', () => {
		expect(() => cleanupWorker('nonexistent')).not.toThrow();
	});

	it('calls clearWorkItemEnqueued when worker has projectId, workItemId, and agentType', async () => {
		const { resolveWait } = setupMockContainer();

		await spawnWorker(
			makeJob({
				id: 'job-wi',
				data: {
					type: 'trello',
					projectId: 'proj-1',
					cardId: 'card-1',
					agentType: 'implementation',
				} as CascadeJob,
			}) as never,
		);

		cleanupWorker('job-wi');
		expect(mockClearWorkItemEnqueued).toHaveBeenCalledWith('proj-1', 'card-1', 'implementation');

		resolveWait();
	});

	it('calls failOrphanedRun on non-zero exit code', async () => {
		const { resolveWait } = setupMockContainer();
		mockFailOrphanedRun.mockResolvedValue('run-123');

		await spawnWorker(
			makeJob({
				id: 'job-fail-orphan',
				data: {
					type: 'trello',
					projectId: 'proj-1',
					cardId: 'card-1',
					agentType: 'implementation',
				} as CascadeJob,
			}) as never,
		);

		cleanupWorker('job-fail-orphan', 1);
		expect(mockFailOrphanedRun).toHaveBeenCalledWith(
			'proj-1',
			'card-1',
			'Worker crashed with exit code 1',
		);

		resolveWait();
	});

	it('does NOT call failOrphanedRun on zero exit code', async () => {
		const { resolveWait } = setupMockContainer();

		await spawnWorker(
			makeJob({
				id: 'job-ok',
				data: {
					type: 'trello',
					projectId: 'proj-1',
					cardId: 'card-1',
					agentType: 'implementation',
				} as CascadeJob,
			}) as never,
		);

		cleanupWorker('job-ok', 0);
		expect(mockFailOrphanedRun).not.toHaveBeenCalled();

		resolveWait();
	});

	it('calls failOrphanedRun but NOT clearWorkItemEnqueued when agentType is missing', async () => {
		const { resolveWait } = setupMockContainer();
		mockFailOrphanedRun.mockResolvedValue('run-no-agent');

		await spawnWorker(
			makeJob({
				id: 'job-no-agent',
				data: {
					type: 'trello',
					projectId: 'proj-1',
					cardId: 'card-1',
				} as CascadeJob,
			}) as never,
		);

		cleanupWorker('job-no-agent', 1);
		expect(mockClearWorkItemEnqueued).not.toHaveBeenCalled();
		expect(mockFailOrphanedRun).toHaveBeenCalledWith(
			'proj-1',
			'card-1',
			'Worker crashed with exit code 1',
		);

		resolveWait();
	});

	it('does NOT call failOrphanedRun when exitCode is undefined', async () => {
		const { resolveWait } = setupMockContainer();

		await spawnWorker(
			makeJob({
				id: 'job-undef',
				data: { type: 'trello', projectId: 'proj-1', cardId: 'card-1' } as CascadeJob,
			}) as never,
		);

		cleanupWorker('job-undef');
		expect(mockFailOrphanedRun).not.toHaveBeenCalled();

		resolveWait();
	});
});

// ---------------------------------------------------------------------------
// detachAll
// ---------------------------------------------------------------------------

describe('detachAll', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockResolvedValue({});
		detachAll();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		detachAll();
	});

	it('clears all tracked workers', async () => {
		setupMockContainer();
		await spawnWorker(makeJob({ id: 'job-d1' }) as never);
		expect(getActiveWorkerCount()).toBeGreaterThan(0);

		detachAll();
		expect(getActiveWorkerCount()).toBe(0);
	});

	it('calls clearAllWorkItemLocks on detach', async () => {
		setupMockContainer();
		await spawnWorker(makeJob({ id: 'job-d2' }) as never);

		mockClearAllWorkItemLocks.mockClear();
		detachAll();
		expect(mockClearAllWorkItemLocks).toHaveBeenCalled();
	});
});

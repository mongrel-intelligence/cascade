import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — vi.hoisted creates variables before vi.mock factories run
// ---------------------------------------------------------------------------

const {
	mockDockerCreateContainer,
	mockDockerGetContainer,
	mockDockerListContainers,
	mockLoadProjectConfig,
} = vi.hoisted(() => ({
	mockDockerCreateContainer: vi.fn(),
	mockDockerGetContainer: vi.fn(),
	mockDockerListContainers: vi.fn(),
	mockLoadProjectConfig: vi.fn().mockResolvedValue({ projects: [], fullProjects: [] }),
}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		createContainer: mockDockerCreateContainer,
		getContainer: mockDockerGetContainer,
		listContainers: mockDockerListContainers,
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
const mockFailOrphanedRunFallback = vi.fn().mockResolvedValue(null);
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	failOrphanedRun: (...args: unknown[]) => mockFailOrphanedRun(...args),
	failOrphanedRunFallback: (...args: unknown[]) => mockFailOrphanedRunFallback(...args),
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
	loadProjectConfig: (...args: unknown[]) => mockLoadProjectConfig(...args),
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
	scanAndCleanupOrphans,
	spawnWorker,
	startOrphanCleanup,
	stopOrphanCleanup,
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

	it('forwards CASCADE_DASHBOARD_URL when set', async () => {
		process.env.CASCADE_DASHBOARD_URL = 'https://dev.cascade.example.com';
		try {
			const env = await buildWorkerEnv(makeJob() as never);
			expect(env).toContain('CASCADE_DASHBOARD_URL=https://dev.cascade.example.com');
		} finally {
			Reflect.deleteProperty(process.env, 'CASCADE_DASHBOARD_URL');
		}
	});

	it('omits CASCADE_DASHBOARD_URL when not set', async () => {
		Reflect.deleteProperty(process.env, 'CASCADE_DASHBOARD_URL');
		const env = await buildWorkerEnv(makeJob() as never);
		expect(env.some((e) => e.startsWith('CASCADE_DASHBOARD_URL='))).toBe(false);
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
		mockLoadProjectConfig.mockResolvedValue({ projects: [], fullProjects: [] });
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

	it('includes cascade.project.id label in container config', async () => {
		const { resolveWait } = setupMockContainer();

		await spawnWorker(
			makeJob({
				id: 'job-label',
				data: { type: 'trello', projectId: 'proj-42' } as CascadeJob,
			}) as never,
		);

		expect(mockDockerCreateContainer).toHaveBeenCalledWith(
			expect.objectContaining({
				Labels: expect.objectContaining({
					'cascade.project.id': 'proj-42',
					'cascade.managed': 'true',
					'cascade.agent.type': '',
				}),
			}),
		);

		resolveWait();
	});

	it('uses project watchdogTimeoutMs + 2min buffer when available', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-1', watchdogTimeoutMs: 10000 }],
		});
		vi.useFakeTimers();
		const { container, resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		// At watchdogTimeoutMs + 2min - 1ms: should NOT yet have triggered kill
		vi.advanceTimersByTime(10000 + 2 * 60 * 1000 - 1);
		expect(container.stop).not.toHaveBeenCalled();

		// One more ms: should trigger killWorker → container.stop
		await vi.advanceTimersByTimeAsync(1);
		expect(container.stop).toHaveBeenCalled();

		resolveWait();
		vi.useRealTimers();
		mockLoadProjectConfig.mockResolvedValue({ projects: [], fullProjects: [] });
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
		mockLoadProjectConfig.mockResolvedValue({ projects: [], fullProjects: [] });
		mockFailOrphanedRun.mockResolvedValue(null);
		mockFailOrphanedRunFallback.mockResolvedValue(null);
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

	it('calls failOrphanedRunFallback on kill when worker has no workItemId', async () => {
		mockFailOrphanedRunFallback.mockResolvedValue('run-kill-fallback');
		const { resolveWait } = setupMockContainer();

		// Default job: projectId='proj-1', no workItemId
		await spawnWorker(makeJob({ id: 'job-kill-fallback' }) as never);
		await killWorker('job-kill-fallback');

		// Fire-and-forget — flush microtasks
		await new Promise((r) => setTimeout(r, 10));
		expect(mockFailOrphanedRunFallback).toHaveBeenCalledWith(
			'proj-1',
			undefined, // no agentType on default job
			expect.any(Date),
			'timed_out',
			'Router timeout',
			expect.any(Number),
		);
		// Verify no double-call (cleanupWorker must NOT also trigger a DB update)
		expect(mockFailOrphanedRunFallback).toHaveBeenCalledTimes(1);

		resolveWait();
	});

	it('calls failOrphanedRun with timed_out on kill when worker has workItemId', async () => {
		mockFailOrphanedRun.mockResolvedValue('run-kill-wi');
		const { resolveWait } = setupMockContainer();

		await spawnWorker(
			makeJob({
				id: 'job-kill-wi',
				data: {
					type: 'trello',
					projectId: 'proj-1',
					workItemId: 'card-1',
				} as CascadeJob,
			}) as never,
		);
		await killWorker('job-kill-wi');

		// Fire-and-forget — flush microtasks
		await new Promise((r) => setTimeout(r, 10));
		expect(mockFailOrphanedRun).toHaveBeenCalledWith(
			'proj-1',
			'card-1',
			'Router timeout',
			'timed_out',
			expect.any(Number),
		);
		// Verify no double-call (cleanupWorker must NOT also trigger a DB update)
		expect(mockFailOrphanedRun).toHaveBeenCalledTimes(1);

		resolveWait();
	});
});

// ---------------------------------------------------------------------------
// cleanupWorker
// ---------------------------------------------------------------------------

describe('cleanupWorker', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockResolvedValue({});
		mockLoadProjectConfig.mockResolvedValue({ projects: [], fullProjects: [] });
		mockFailOrphanedRun.mockResolvedValue(null);
		mockFailOrphanedRunFallback.mockResolvedValue(null);
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
					workItemId: 'card-1',
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
					workItemId: 'card-1',
					agentType: 'implementation',
				} as CascadeJob,
			}) as never,
		);

		cleanupWorker('job-fail-orphan', 1);
		expect(mockFailOrphanedRun).toHaveBeenCalledWith(
			'proj-1',
			'card-1',
			'Worker crashed with exit code 1',
			'failed',
			expect.any(Number),
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
					workItemId: 'card-1',
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
					workItemId: 'card-1',
				} as CascadeJob,
			}) as never,
		);

		cleanupWorker('job-no-agent', 1);
		expect(mockClearWorkItemEnqueued).not.toHaveBeenCalled();
		expect(mockFailOrphanedRun).toHaveBeenCalledWith(
			'proj-1',
			'card-1',
			'Worker crashed with exit code 1',
			'failed',
			expect.any(Number),
		);

		resolveWait();
	});

	it('does NOT call failOrphanedRun when exitCode is undefined', async () => {
		const { resolveWait } = setupMockContainer();

		await spawnWorker(
			makeJob({
				id: 'job-undef',
				data: { type: 'trello', projectId: 'proj-1', workItemId: 'card-1' } as CascadeJob,
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
		mockLoadProjectConfig.mockResolvedValue({ projects: [], fullProjects: [] });
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

	it('calls stopOrphanCleanup on detach', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		setupMockContainer();
		await spawnWorker(makeJob({ id: 'job-d3' }) as never);

		startOrphanCleanup();
		expect(() => detachAll()).not.toThrow();
		// orphan cleanup timer should be cleared
	});
});

// ---------------------------------------------------------------------------
// startOrphanCleanup / stopOrphanCleanup
// ---------------------------------------------------------------------------

describe('orphan cleanup', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockResolvedValue({});
		mockLoadProjectConfig.mockResolvedValue({ projects: [], fullProjects: [] });
		mockDockerListContainers.mockResolvedValue([]);
		detachAll();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		stopOrphanCleanup();
		detachAll();
	});

	describe('startOrphanCleanup / stopOrphanCleanup', () => {
		it('starts a periodic orphan cleanup scan', () => {
			expect(() => startOrphanCleanup()).not.toThrow();
			stopOrphanCleanup();
		});

		it('stops the orphan cleanup scan', () => {
			startOrphanCleanup();
			expect(() => stopOrphanCleanup()).not.toThrow();
		});

		it('is a no-op to stop if not started', () => {
			expect(() => stopOrphanCleanup()).not.toThrow();
		});

		it('is idempotent on multiple calls', () => {
			startOrphanCleanup();
			expect(() => startOrphanCleanup()).not.toThrow();
			stopOrphanCleanup();
		});

		it('allows multiple start/stop cycles', () => {
			expect(() => {
				startOrphanCleanup();
				stopOrphanCleanup();
				startOrphanCleanup();
				stopOrphanCleanup();
			}).not.toThrow();
		});
	});

	describe('scanAndCleanupOrphans', () => {
		it('lists containers with cascade.managed=true label', async () => {
			mockDockerListContainers.mockResolvedValue([]);

			await scanAndCleanupOrphans();

			expect(mockDockerListContainers).toHaveBeenCalledWith(
				expect.objectContaining({
					all: false,
					filters: expect.objectContaining({
						label: expect.arrayContaining(['cascade.managed=true']),
					}),
				}),
			);
		});

		it('skips tracked containers', async () => {
			setupMockContainer();
			await spawnWorker(makeJob({ id: 'job-tracked' }) as never);

			const trackedContainerId = 'container-abc123def456';
			mockDockerListContainers.mockResolvedValue([
				{
					Id: trackedContainerId,
					Created: Math.floor(Date.now() / 1000) - 1000, // Very old
					State: 'running',
				} as never,
			]);

			await scanAndCleanupOrphans();

			// Container should NOT be stopped since it's tracked
			expect(mockDockerGetContainer).not.toHaveBeenCalled();
		});

		it('stops orphaned containers older than workerTimeoutMs', async () => {
			const orphanContainerId = 'orphan-container-old';
			const now = Math.floor(Date.now() / 1000);
			const createdAt = now - 6; // 6 seconds old, workerTimeoutMs is 5000ms

			const mockOrphanContainer = {
				stop: vi.fn().mockResolvedValue(undefined),
			};
			mockDockerListContainers.mockResolvedValue([
				{
					Id: orphanContainerId,
					Created: createdAt,
					State: 'running',
				} as never,
			]);
			mockDockerGetContainer.mockReturnValue(mockOrphanContainer as never);

			await scanAndCleanupOrphans();

			expect(mockOrphanContainer.stop).toHaveBeenCalledWith({ t: 15 });
		});

		it('leaves young orphaned containers alone', async () => {
			const youngContainerId = 'orphan-container-young';
			const now = Math.floor(Date.now() / 1000);
			const createdAt = now - 1; // 1 second old, workerTimeoutMs is 5000ms

			const mockYoungContainer = {
				stop: vi.fn(),
			};
			mockDockerListContainers.mockResolvedValue([
				{
					Id: youngContainerId,
					Created: createdAt,
					State: 'running',
				} as never,
			]);
			mockDockerGetContainer.mockReturnValue(mockYoungContainer as never);

			await scanAndCleanupOrphans();

			// Young container should NOT be stopped
			expect(mockYoungContainer.stop).not.toHaveBeenCalled();
		});

		it('handles Docker list errors', async () => {
			mockDockerListContainers.mockRejectedValue(new Error('Docker unavailable'));

			await expect(scanAndCleanupOrphans()).rejects.toThrow('Docker unavailable');
		});

		it('handles container stop errors gracefully', async () => {
			const orphanContainerId = 'orphan-stop-fails';
			const now = Math.floor(Date.now() / 1000);
			const createdAt = now - 6; // Old enough

			const mockFailContainer = {
				stop: vi.fn().mockRejectedValue(new Error('already stopped')),
			};
			mockDockerListContainers.mockResolvedValue([
				{
					Id: orphanContainerId,
					Created: createdAt,
					State: 'running',
				} as never,
			]);
			mockDockerGetContainer.mockReturnValue(mockFailContainer as never);

			// Should not throw, just log error
			await expect(scanAndCleanupOrphans()).resolves.toBeUndefined();
			expect(mockFailContainer.stop).toHaveBeenCalled();
		});

		it('stops multiple orphaned containers', async () => {
			const now = Math.floor(Date.now() / 1000);

			const mockContainer1 = {
				stop: vi.fn().mockResolvedValue(undefined),
			};
			const mockContainer2 = {
				stop: vi.fn().mockResolvedValue(undefined),
			};

			mockDockerListContainers.mockResolvedValue([
				{
					Id: 'orphan-1',
					Created: now - 6,
					State: 'running',
				} as never,
				{
					Id: 'orphan-2',
					Created: now - 10,
					State: 'running',
				} as never,
			]);

			mockDockerGetContainer.mockImplementation((id: string) => {
				if (id === 'orphan-1') return mockContainer1 as never;
				if (id === 'orphan-2') return mockContainer2 as never;
				return null;
			});

			await scanAndCleanupOrphans();

			expect(mockContainer1.stop).toHaveBeenCalledWith({ t: 15 });
			expect(mockContainer2.stop).toHaveBeenCalledWith({ t: 15 });
		});

		it('stops orphans but leaves tracked and young containers', async () => {
			setupMockContainer();
			await spawnWorker(makeJob({ id: 'job-tracked' }) as never);

			const now = Math.floor(Date.now() / 1000);
			const mockedOrphanContainer = {
				stop: vi.fn().mockResolvedValue(undefined),
			};
			const mockedYoungContainer = {
				stop: vi.fn().mockResolvedValue(undefined),
			};

			mockDockerListContainers.mockResolvedValue([
				{
					Id: 'container-abc123def456', // tracked
					Created: now - 10,
					State: 'running',
				} as never,
				{
					Id: 'orphan-old',
					Created: now - 6,
					State: 'running',
				} as never,
				{
					Id: 'orphan-young',
					Created: now - 1,
					State: 'running',
				} as never,
			]);

			mockDockerGetContainer.mockImplementation((id: string) => {
				if (id === 'orphan-old') return mockedOrphanContainer as never;
				if (id === 'orphan-young') return mockedYoungContainer as never;
				return { stop: vi.fn() } as never;
			});

			await scanAndCleanupOrphans();

			// Only the old orphan should be stopped
			expect(mockedOrphanContainer.stop).toHaveBeenCalledWith({ t: 15 });
			expect(mockedYoungContainer.stop).not.toHaveBeenCalled();
		});
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockActiveWorkers, mockDockerCreateContainer, mockLogger } = vi.hoisted(() => ({
	mockActiveWorkers: new Map<string, unknown>(),
	mockDockerCreateContainer: vi.fn(),
	mockLogger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		createContainer: mockDockerCreateContainer,
	})),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		workerImage: 'base-worker:latest',
		workerMemoryMb: 768,
		workerTimeoutMs: 30 * 60 * 1000,
		dockerNetwork: 'cascade-test-network',
	},
}));

vi.mock('../../../src/router/active-workers.js', () => ({
	activeWorkers: mockActiveWorkers,
	cleanupWorker: vi.fn(),
}));

vi.mock('../../../src/router/worker-timeouts.js', () => ({
	killWorker: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/router/worker-exit-handler.js', () => ({
	handleWorkerExit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/router/worker-snapshots.js', () => ({
	commitWorkerSnapshot: vi.fn().mockResolvedValue(undefined),
	removeWorkerContainerBestEffort: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import type { CascadeJob } from '../../../src/router/queue.js';
import {
	launchWorkerContainer,
	type WorkerContainerLauncherDependencies,
} from '../../../src/router/worker-container-launcher.js';

function makeJob(overrides: Partial<{ id: string; data: CascadeJob }> = {}) {
	return {
		id: overrides.id ?? 'job-launcher-1',
		data:
			overrides.data ??
			({
				type: 'trello',
				projectId: 'proj-1',
				workItemId: 'card-1',
				agentType: 'implementation',
			} as CascadeJob),
	};
}

function makeContainer(overrides: Partial<{ wait: () => Promise<{ StatusCode: number }> }> = {}) {
	return {
		id: 'container-launcher-abc123',
		start: vi.fn().mockResolvedValue(undefined),
		wait: vi.fn(overrides.wait ?? (() => new Promise(() => {}))),
	};
}

function makeDependencies(
	overrides: Partial<WorkerContainerLauncherDependencies> = {},
): WorkerContainerLauncherDependencies {
	return {
		createContainer: vi.fn(),
		killWorker: vi.fn().mockResolvedValue(undefined),
		handleWorkerExit: vi.fn().mockResolvedValue(undefined),
		commitWorkerSnapshot: vi.fn().mockResolvedValue(undefined),
		removeWorkerContainerBestEffort: vi.fn().mockResolvedValue(undefined),
		cleanupWorker: vi.fn(),
		captureException: vi.fn(),
		...overrides,
	};
}

function clearTrackedTimeouts() {
	for (const worker of mockActiveWorkers.values()) {
		const timeoutHandle = (worker as { timeoutHandle?: NodeJS.Timeout }).timeoutHandle;
		if (timeoutHandle) clearTimeout(timeoutHandle);
	}
	mockActiveWorkers.clear();
}

describe('worker-container-launcher', () => {
	beforeEach(() => {
		vi.useRealTimers();
		mockDockerCreateContainer.mockReset();
		mockLogger.info.mockClear();
		mockLogger.warn.mockClear();
		mockLogger.error.mockClear();
		clearTrackedTimeouts();
	});

	afterEach(() => {
		vi.useRealTimers();
		clearTrackedTimeouts();
	});

	it('preserves the Docker create/start config and cascade labels', async () => {
		const container = makeContainer();
		const dependencies = makeDependencies({
			createContainer: vi.fn().mockResolvedValue(container),
		});

		await launchWorkerContainer(
			{
				job: makeJob() as never,
				jobId: 'job-launcher-1',
				containerName: 'cascade-worker-job-launcher-1',
				projectId: 'proj-1',
				workItemId: 'card-1',
				agentType: 'implementation',
			},
			{
				workerImage: 'snapshot-worker:latest',
				snapshotEnabled: true,
				containerTimeoutMs: 5000,
				workerEnv: ['JOB_ID=job-launcher-1', 'JOB_TYPE=trello'],
			},
			dependencies,
		);

		expect(dependencies.createContainer).toHaveBeenCalledWith({
			Image: 'snapshot-worker:latest',
			name: 'cascade-worker-job-launcher-1',
			Env: ['JOB_ID=job-launcher-1', 'JOB_TYPE=trello'],
			HostConfig: {
				Memory: 768 * 1024 * 1024,
				MemorySwap: 768 * 1024 * 1024,
				NetworkMode: 'cascade-test-network',
				AutoRemove: false,
			},
			Labels: expect.objectContaining({
				'cascade.job.id': 'job-launcher-1',
				'cascade.job.type': 'trello',
				'cascade.managed': 'true',
				'cascade.router.instance': expect.any(String),
				'cascade.project.id': 'proj-1',
				'cascade.agent.type': 'implementation',
				'cascade.snapshot.enabled': 'true',
			}),
		});
		expect(container.start).toHaveBeenCalled();
		expect(mockActiveWorkers.get('job-launcher-1')).toEqual(
			expect.objectContaining({
				containerId: 'container-launcher-abc123',
				jobId: 'job-launcher-1',
				projectId: 'proj-1',
				workItemId: 'card-1',
				agentType: 'implementation',
			}),
		);
	});

	it('keeps the base launch posture for a custom-image digest: only resource/network limits + Labels, no mounts/privileged (spec 022 AC #9)', async () => {
		const container = makeContainer();
		const dependencies = makeDependencies({
			createContainer: vi.fn().mockResolvedValue(container),
		});

		await launchWorkerContainer(
			{
				job: makeJob() as never,
				jobId: 'job-custom-img',
				containerName: 'cascade-worker-job-custom-img',
				projectId: 'proj-1',
				workItemId: 'card-1',
				agentType: 'implementation',
			},
			{
				// A per-project verified digest launches through the identical path.
				workerImage: 'sha256:abc',
				snapshotEnabled: false,
				containerTimeoutMs: 5000,
				workerEnv: [],
			},
			dependencies,
		);

		const createArg = vi.mocked(dependencies.createContainer).mock.calls[0]?.[0] as {
			Image: string;
			HostConfig: Record<string, unknown>;
		};
		expect(createArg.Image).toBe('sha256:abc');
		// Launch posture is byte-for-byte the base-image shape — only resource +
		// network limits + AutoRemove. A future mount/privileged regression fails here.
		expect(createArg.HostConfig).toEqual({
			Memory: 768 * 1024 * 1024,
			MemorySwap: 768 * 1024 * 1024,
			NetworkMode: 'cascade-test-network',
			AutoRemove: true,
		});
		expect(createArg.HostConfig).not.toHaveProperty('Binds');
		expect(createArg.HostConfig).not.toHaveProperty('Mounts');
		expect(createArg.HostConfig).not.toHaveProperty('Privileged');
	});

	it('uses AutoRemove=true and blank optional labels when snapshots and metadata are absent', async () => {
		const container = makeContainer();
		const dependencies = makeDependencies({
			createContainer: vi.fn().mockResolvedValue(container),
		});

		await launchWorkerContainer(
			{
				job: makeJob({ data: { type: 'github' } as CascadeJob }) as never,
				jobId: 'job-no-project',
				containerName: 'cascade-worker-job-no-project',
				projectId: null,
				workItemId: undefined,
				agentType: undefined,
			},
			{
				workerImage: 'base-worker:latest',
				snapshotEnabled: false,
				containerTimeoutMs: 5000,
				workerEnv: [],
			},
			dependencies,
		);

		expect(dependencies.createContainer).toHaveBeenCalledWith(
			expect.objectContaining({
				HostConfig: expect.objectContaining({ AutoRemove: true }),
				Labels: expect.objectContaining({
					'cascade.project.id': '',
					'cascade.agent.type': '',
					'cascade.snapshot.enabled': 'false',
				}),
			}),
		);
	});

	it('fires the router timeout path through killWorker and captures warning context', async () => {
		vi.useFakeTimers();
		const container = makeContainer();
		const dependencies = makeDependencies({
			createContainer: vi.fn().mockResolvedValue(container),
		});

		await launchWorkerContainer(
			{
				job: makeJob() as never,
				jobId: 'job-timeout',
				containerName: 'cascade-worker-job-timeout',
				projectId: 'proj-1',
				workItemId: 'card-1',
				agentType: 'implementation',
			},
			{
				workerImage: 'base-worker:latest',
				snapshotEnabled: false,
				containerTimeoutMs: 1000,
				workerEnv: [],
			},
			dependencies,
		);

		await vi.advanceTimersByTimeAsync(1000);

		expect(mockLogger.warn).toHaveBeenCalledWith(
			'[WorkerManager] Worker timeout, killing:',
			expect.objectContaining({ jobId: 'job-timeout' }),
		);
		expect(dependencies.captureException).toHaveBeenCalledWith(expect.any(Error), {
			tags: { source: 'worker_timeout', jobType: 'trello' },
			extra: expect.objectContaining({ jobId: 'job-timeout' }),
			level: 'warning',
		});
		expect(dependencies.killWorker).toHaveBeenCalledWith('job-timeout');
	});

	it('delegates successful waits to worker-exit-handler with snapshot dependencies', async () => {
		const container = makeContainer({ wait: () => Promise.resolve({ StatusCode: 0 }) });
		const dependencies = makeDependencies({
			createContainer: vi.fn().mockResolvedValue(container),
		});

		await launchWorkerContainer(
			{
				job: makeJob() as never,
				jobId: 'job-exit',
				containerName: 'cascade-worker-job-exit',
				projectId: 'proj-1',
				workItemId: 'card-1',
				agentType: 'implementation',
			},
			{
				workerImage: 'base-worker:latest',
				snapshotEnabled: true,
				containerTimeoutMs: 5000,
				workerEnv: [],
			},
			dependencies,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(dependencies.handleWorkerExit).toHaveBeenCalledWith(
			expect.objectContaining({
				container,
				result: { StatusCode: 0 },
				jobId: 'job-exit',
				jobType: 'trello',
				snapshotEnabled: true,
				projectId: 'proj-1',
				workItemId: 'card-1',
				dependencies: {
					commitWorkerSnapshot: dependencies.commitWorkerSnapshot,
					removeWorkerContainerBestEffort: dependencies.removeWorkerContainerBestEffort,
					cleanupWorker: dependencies.cleanupWorker,
				},
			}),
		);
	});

	it('captures wait errors, removes snapshot containers, and clears tracking', async () => {
		const waitError = new Error('wait failed');
		const container = makeContainer({ wait: () => Promise.reject(waitError) });
		const dependencies = makeDependencies({
			createContainer: vi.fn().mockResolvedValue(container),
		});

		await launchWorkerContainer(
			{
				job: makeJob() as never,
				jobId: 'job-wait-error',
				containerName: 'cascade-worker-job-wait-error',
				projectId: 'proj-1',
				workItemId: 'card-1',
				agentType: 'implementation',
			},
			{
				workerImage: 'base-worker:latest',
				snapshotEnabled: true,
				containerTimeoutMs: 5000,
				workerEnv: [],
			},
			dependencies,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(mockLogger.error).toHaveBeenCalledWith(
			'[WorkerManager] Error waiting for container:',
			waitError,
		);
		expect(dependencies.captureException).toHaveBeenCalledWith(waitError, {
			tags: { source: 'worker_wait', jobType: 'trello' },
			extra: { jobId: 'job-wait-error' },
		});
		expect(dependencies.removeWorkerContainerBestEffort).toHaveBeenCalledWith(
			'container-launcher-abc123',
		);
		expect(dependencies.cleanupWorker).toHaveBeenCalledWith('job-wait-error');
	});
});

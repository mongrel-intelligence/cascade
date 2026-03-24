/**
 * Tests for snapshot-related behaviour in container-manager.ts:
 * - Snapshot-disabled projects use AutoRemove=true and the base worker image
 * - Snapshot hit: uses snapshot image, AutoRemove=false
 * - Snapshot miss: uses base image, AutoRemove=false
 * - Successful exit: commits container to snapshot
 * - Non-zero exit: does NOT commit container to snapshot
 * - Container is removed after exit for snapshot-enabled runs
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const {
	mockDockerCreateContainer,
	mockDockerGetContainer,
	mockLoadProjectConfig,
	mockGetSnapshot,
	mockRegisterSnapshot,
} = vi.hoisted(() => ({
	mockDockerCreateContainer: vi.fn(),
	mockDockerGetContainer: vi.fn(),
	mockLoadProjectConfig: vi.fn().mockResolvedValue({ projects: [], fullProjects: [] }),
	mockGetSnapshot: vi.fn().mockReturnValue(undefined),
	mockRegisterSnapshot: vi.fn(),
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
	getAllProjectCredentials: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	failOrphanedRun: vi.fn().mockResolvedValue(null),
	failOrphanedRunFallback: vi.fn().mockResolvedValue(null),
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

vi.mock('../../../src/router/work-item-lock.js', () => ({
	clearWorkItemEnqueued: vi.fn(),
	clearAllWorkItemLocks: vi.fn(),
}));

vi.mock('../../../src/router/agent-type-lock.js', () => ({
	clearAgentTypeEnqueued: vi.fn(),
	clearAllAgentTypeLocks: vi.fn(),
}));

vi.mock('../../../src/router/snapshot-manager.js', () => ({
	getSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
	registerSnapshot: (...args: unknown[]) => mockRegisterSnapshot(...args),
	invalidateSnapshot: vi.fn(),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		redisUrl: 'redis://localhost:6379',
		maxWorkers: 3,
		workerImage: 'base-worker:latest',
		workerMemoryMb: 512,
		workerTimeoutMs: 5000,
		dockerNetwork: 'test-network',
		snapshotEnabled: false,
		snapshotDefaultTtlMs: 86400000,
		snapshotMaxCount: 5,
		snapshotMaxSizeBytes: 10737418240,
	},
	loadProjectConfig: (...args: unknown[]) => mockLoadProjectConfig(...args),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { getAllProjectCredentials } from '../../../src/config/provider.js';
import { detachAll, spawnWorker } from '../../../src/router/container-manager.js';
import type { CascadeJob } from '../../../src/router/queue.js';

const mockGetAllProjectCredentials = vi.mocked(getAllProjectCredentials);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<{ id: string; data: CascadeJob }> = {}) {
	return {
		id: overrides.id ?? 'job-snap-1',
		data:
			overrides.data ??
			({
				type: 'trello',
				projectId: 'proj-snap',
				workItemId: 'card-snap',
			} as CascadeJob),
	};
}

function setupMockContainer(exitCode = 0) {
	let resolveWait!: (v: { StatusCode: number }) => void;
	const waitPromise = new Promise<{ StatusCode: number }>((res) => {
		resolveWait = res;
	});

	const container = {
		id: 'container-snap-abc123',
		start: vi.fn().mockResolvedValue(undefined),
		wait: vi.fn().mockReturnValue(waitPromise),
		logs: vi.fn().mockResolvedValue(Buffer.from('')),
		stop: vi.fn().mockResolvedValue(undefined),
		commit: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
	};

	mockDockerCreateContainer.mockResolvedValue(container);
	mockDockerGetContainer.mockReturnValue(container);

	return {
		container,
		resolveWait: (code = exitCode) => resolveWait({ StatusCode: code }),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('spawnWorker — snapshot disabled', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockResolvedValue({});
		mockLoadProjectConfig.mockResolvedValue({ projects: [], fullProjects: [] });
		mockGetSnapshot.mockReturnValue(undefined);
		detachAll();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		detachAll();
	});

	it('uses base worker image and AutoRemove=true when snapshot is disabled for project', async () => {
		// snapshotEnabled not set on project — defaults to routerConfig.snapshotEnabled (false)
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', watchdogTimeoutMs: undefined, snapshotEnabled: false }],
		});
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		expect(mockDockerCreateContainer).toHaveBeenCalledWith(
			expect.objectContaining({
				Image: 'base-worker:latest',
				HostConfig: expect.objectContaining({ AutoRemove: true }),
			}),
		);

		resolveWait();
	});

	it('does NOT commit the container on successful exit when snapshot is disabled', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', snapshotEnabled: false }],
		});
		const { container, resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		resolveWait(0);
		await new Promise((r) => setTimeout(r, 20));

		expect(container.commit).not.toHaveBeenCalled();
		expect(mockRegisterSnapshot).not.toHaveBeenCalled();
	});
});

describe('spawnWorker — snapshot miss (enabled, no existing snapshot)', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockResolvedValue({});
		mockGetSnapshot.mockReturnValue(undefined); // no snapshot in registry
		detachAll();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		detachAll();
	});

	it('falls back to base worker image when no snapshot exists', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', snapshotEnabled: true }],
		});
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		expect(mockDockerCreateContainer).toHaveBeenCalledWith(
			expect.objectContaining({ Image: 'base-worker:latest' }),
		);

		resolveWait();
	});

	it('uses AutoRemove=false when snapshot is enabled (miss)', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', snapshotEnabled: true }],
		});
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		expect(mockDockerCreateContainer).toHaveBeenCalledWith(
			expect.objectContaining({
				HostConfig: expect.objectContaining({ AutoRemove: false }),
			}),
		);

		resolveWait();
	});

	it('commits container on successful exit and removes it', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', snapshotEnabled: true }],
		});
		const { container, resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		resolveWait(0);
		await new Promise((r) => setTimeout(r, 20));

		expect(container.commit).toHaveBeenCalledWith(
			expect.objectContaining({
				repo: expect.stringContaining('cascade-snapshot-proj-snap-card-snap'),
				tag: 'latest',
			}),
		);
		expect(container.remove).toHaveBeenCalled();
	});

	it('does NOT commit on non-zero exit', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', snapshotEnabled: true }],
		});
		const { container, resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		resolveWait(1); // non-zero exit
		await new Promise((r) => setTimeout(r, 20));

		expect(container.commit).not.toHaveBeenCalled();
		expect(mockRegisterSnapshot).not.toHaveBeenCalled();
	});

	it('removes container even on non-zero exit (snapshot run cleanup)', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', snapshotEnabled: true }],
		});
		const { container, resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		resolveWait(1);
		await new Promise((r) => setTimeout(r, 20));

		expect(container.remove).toHaveBeenCalled();
	});
});

describe('spawnWorker — snapshot hit (existing snapshot)', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockResolvedValue({});
		detachAll();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		detachAll();
	});

	it('uses the snapshot image when a snapshot exists', async () => {
		mockGetSnapshot.mockReturnValue({
			imageName: 'cascade-snapshot-proj-snap-card-snap:latest',
			projectId: 'proj-snap',
			workItemId: 'card-snap',
			createdAt: new Date(),
		});
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', snapshotEnabled: true }],
		});
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		expect(mockDockerCreateContainer).toHaveBeenCalledWith(
			expect.objectContaining({
				Image: 'cascade-snapshot-proj-snap-card-snap:latest',
			}),
		);

		resolveWait();
	});

	it('uses AutoRemove=false when snapshot is enabled (hit)', async () => {
		mockGetSnapshot.mockReturnValue({
			imageName: 'cascade-snapshot-proj-snap-card-snap:latest',
			projectId: 'proj-snap',
			workItemId: 'card-snap',
			createdAt: new Date(),
		});
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', snapshotEnabled: true }],
		});
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		expect(mockDockerCreateContainer).toHaveBeenCalledWith(
			expect.objectContaining({
				HostConfig: expect.objectContaining({ AutoRemove: false }),
			}),
		);

		resolveWait();
	});

	it('sets cascade.snapshot.enabled label to true', async () => {
		mockGetSnapshot.mockReturnValue({
			imageName: 'cascade-snapshot-proj-snap-card-snap:latest',
			projectId: 'proj-snap',
			workItemId: 'card-snap',
			createdAt: new Date(),
		});
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', snapshotEnabled: true }],
		});
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		expect(mockDockerCreateContainer).toHaveBeenCalledWith(
			expect.objectContaining({
				Labels: expect.objectContaining({
					'cascade.snapshot.enabled': 'true',
				}),
			}),
		);

		resolveWait();
	});

	it('commits container on successful exit after snapshot hit', async () => {
		mockGetSnapshot.mockReturnValue({
			imageName: 'cascade-snapshot-proj-snap-card-snap:latest',
			projectId: 'proj-snap',
			workItemId: 'card-snap',
			createdAt: new Date(),
		});
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', snapshotEnabled: true }],
		});
		const { container, resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		resolveWait(0);
		await new Promise((r) => setTimeout(r, 20));

		expect(container.commit).toHaveBeenCalled();
		expect(mockRegisterSnapshot).toHaveBeenCalledWith(
			'proj-snap',
			'card-snap',
			expect.stringContaining('cascade-snapshot-proj-snap-card-snap'),
		);
	});
});

describe('spawnWorker — per-project snapshotTtlMs forwarded to getSnapshot', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockResolvedValue({});
		mockGetSnapshot.mockReturnValue(undefined);
		detachAll();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		detachAll();
	});

	it('passes per-project snapshotTtlMs as the ttlMs arg to getSnapshot', async () => {
		const projectSnapshotTtlMs = 3600000; // 1 hour (overrides global 24h default)
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{ id: 'proj-snap', snapshotEnabled: true, snapshotTtlMs: projectSnapshotTtlMs },
			],
		});
		setupMockContainer();

		await spawnWorker(makeJob() as never);

		// getSnapshot should have been called with the project's TTL, not the global default
		expect(mockGetSnapshot).toHaveBeenCalledWith('proj-snap', 'card-snap', projectSnapshotTtlMs);
	});

	it('passes global snapshotDefaultTtlMs when project has no snapshotTtlMs', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', snapshotEnabled: true }],
		});
		setupMockContainer();

		await spawnWorker(makeJob() as never);

		// getSnapshot should have been called with the global default TTL (86400000)
		expect(mockGetSnapshot).toHaveBeenCalledWith('proj-snap', 'card-snap', 86400000);
	});
});

describe('spawnWorker — snapshot label on disabled project', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockResolvedValue({});
		mockGetSnapshot.mockReturnValue(undefined);
		detachAll();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		detachAll();
	});

	it('sets cascade.snapshot.enabled label to false when snapshot is disabled', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', snapshotEnabled: false }],
		});
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		expect(mockDockerCreateContainer).toHaveBeenCalledWith(
			expect.objectContaining({
				Labels: expect.objectContaining({
					'cascade.snapshot.enabled': 'false',
				}),
			}),
		);

		resolveWait();
	});
});

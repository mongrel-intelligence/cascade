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
	mockDockerGetImage,
	mockDockerPull,
	mockFollowProgress,
	mockLoadProjectConfig,
	mockGetSnapshot,
	mockRegisterSnapshot,
	mockInvalidateSnapshot,
} = vi.hoisted(() => ({
	mockDockerCreateContainer: vi.fn(),
	mockDockerGetContainer: vi.fn(),
	// commitWorkerSnapshot inspects the freshly committed image to
	// populate imageSizeBytes; default to a fixed size so registerSnapshot
	// receives a deterministic 4th argument.
	mockDockerGetImage: vi.fn().mockReturnValue({
		inspect: vi.fn().mockResolvedValue({ Size: 1_234_567_890 }),
	}),
	mockDockerPull: vi.fn().mockResolvedValue({}),
	mockFollowProgress: vi
		.fn()
		.mockImplementation((_stream: unknown, cb: (err: Error | null) => void) => cb(null)),
	mockLoadProjectConfig: vi.fn().mockResolvedValue({ projects: [], fullProjects: [] }),
	mockGetSnapshot: vi.fn().mockReturnValue(undefined),
	mockRegisterSnapshot: vi.fn(),
	mockInvalidateSnapshot: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		createContainer: mockDockerCreateContainer,
		getContainer: mockDockerGetContainer,
		getImage: mockDockerGetImage,
		pull: mockDockerPull,
		modem: { followProgress: mockFollowProgress },
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
	invalidateSnapshot: (...args: unknown[]) => mockInvalidateSnapshot(...args),
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
// Trello resolution goes through the PM provider manifest registry as of
// plan 006/2 — the side-effect import registers the manifest before spawn
// resolves the job's projectId.
import '../../../src/integrations/pm/trello/index.js';
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
		// inspect() is called by the post-exit pipeline to read State.OOMKilled +
		// State.Error before AutoRemove reaps the container. Stub a minimal,
		// non-OOM, normally-exited shape — individual tests can override.
		inspect: vi.fn().mockResolvedValue({
			State: {
				OOMKilled: false,
				Error: '',
				StartedAt: '2026-04-25T08:00:00.000Z',
				FinishedAt: '2026-04-25T08:00:30.000Z',
			},
		}),
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
// File-wide setup — vi.restoreAllMocks() in per-describe afterEach hooks wipes
// mockReturnValue on hoisted mocks. Re-arm the docker getImage mock here so
// commitWorkerSnapshot's image-size lookup always resolves to a known
// value across every describe.
// ---------------------------------------------------------------------------

beforeEach(() => {
	mockDockerGetImage.mockReturnValue({
		inspect: vi.fn().mockResolvedValue({ Size: 1_234_567_890 }),
	});
	// Pull + followProgress defaults also get wiped by per-describe
	// vi.restoreAllMocks() — re-arm them so the spawn self-heal path's
	// optional pull doesn't hang on a no-op followProgress.
	mockDockerPull.mockResolvedValue({});
	mockFollowProgress.mockImplementation(((_stream: unknown, cb: (err: Error | null) => void) =>
		cb(null)) as never);
});

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
			1_234_567_890, // size from mockDockerGetImage's inspect mock
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

describe('spawnWorker — stale snapshot (image not found fallback)', () => {
	const staleImageError = Object.assign(
		new Error(
			'(HTTP code 404) no such container - No such image: cascade-snapshot-proj-snap-card-snap:latest',
		),
		{ statusCode: 404 },
	);
	const snapshotMetadata = {
		imageName: 'cascade-snapshot-proj-snap-card-snap:latest',
		projectId: 'proj-snap',
		workItemId: 'card-snap',
		createdAt: new Date(),
	};

	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockResolvedValue({});
		mockGetSnapshot.mockReturnValue(snapshotMetadata);
		mockInvalidateSnapshot.mockClear();
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'proj-snap', snapshotEnabled: true }],
		});
		detachAll();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		detachAll();
	});

	it('invalidates stale snapshot and retries with base image when Docker returns 404', async () => {
		// First call (snapshot image) rejects with 404; second call (base image) succeeds
		mockDockerCreateContainer.mockRejectedValueOnce(staleImageError);
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		expect(mockInvalidateSnapshot).toHaveBeenCalledWith('proj-snap', 'card-snap');
		expect(mockDockerCreateContainer).toHaveBeenCalledTimes(2);
		expect(mockDockerCreateContainer).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ Image: 'base-worker:latest' }),
		);

		resolveWait();
	});

	it('fallback still has snapshot enabled (AutoRemove=false, will commit on success)', async () => {
		mockDockerCreateContainer.mockRejectedValueOnce(staleImageError);
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		expect(mockDockerCreateContainer).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				HostConfig: expect.objectContaining({ AutoRemove: false }),
			}),
		);

		resolveWait();
	});

	it('still invalidates the snapshot when the fallback base image also fails', async () => {
		mockDockerCreateContainer
			.mockRejectedValueOnce(staleImageError)
			.mockRejectedValueOnce(new Error('base image also failed'));

		await expect(spawnWorker(makeJob() as never)).rejects.toThrow('base image also failed');

		expect(mockInvalidateSnapshot).toHaveBeenCalledWith('proj-snap', 'card-snap');
	});

	it('self-heals when base image is missing (snapshotReuse=false): pulls then retries spawn', async () => {
		// No snapshot hit — fresh run, snapshotReuse will be false. The catch
		// path now treats a missing base image as recoverable: pull once, retry
		// once. Closes the 2026-06-15 outage class where a pruned base image
		// produced silent UnrecoverableErrors on every spawn.
		mockGetSnapshot.mockReturnValue(undefined);
		const baseImageError = Object.assign(
			new Error('(HTTP code 404) no such container - No such image: base-worker:latest'),
			{ statusCode: 404 },
		);
		mockDockerCreateContainer.mockRejectedValueOnce(baseImageError);
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		expect(mockDockerPull).toHaveBeenCalledTimes(1);
		expect(mockDockerPull).toHaveBeenCalledWith('base-worker:latest');
		expect(mockDockerCreateContainer).toHaveBeenCalledTimes(2);
		// Snapshot invalidation only applies to stale snapshots; base-image
		// recovery does not touch the snapshot registry.
		expect(mockInvalidateSnapshot).not.toHaveBeenCalled();

		resolveWait();
	});
});

describe('spawnWorker — per-project custom image + snapshots (spec 022)', () => {
	const verifiedProject = {
		id: 'proj-snap',
		snapshotEnabled: true,
		workerImage: 'ghcr.io/acme/worker:v3',
		workerImageStatus: 'verified',
		workerImageDigest: 'sha256:abc',
	};

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

	it('launches a custom-image snapshot-miss run from the effective base and commits FROM it', async () => {
		mockGetSnapshot.mockReturnValue(undefined); // snapshot miss
		mockLoadProjectConfig.mockResolvedValue({ projects: [], fullProjects: [verifiedProject] });
		const { container, resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		// Launched FROM the verified digest, never the global default.
		expect(mockDockerCreateContainer).toHaveBeenCalledWith(
			expect.objectContaining({ Image: 'sha256:abc' }),
		);
		expect(mockDockerCreateContainer).not.toHaveBeenCalledWith(
			expect.objectContaining({ Image: 'base-worker:latest' }),
		);

		resolveWait(0);
		await new Promise((r) => setTimeout(r, 20));

		// Snapshot is committed from the container that ran on the effective base.
		expect(container.commit).toHaveBeenCalled();
	});

	it('does NOT misclassify a custom-image run without a snapshot as a reuse', async () => {
		mockGetSnapshot.mockReturnValue(undefined); // snapshot miss → NOT a reuse
		mockLoadProjectConfig.mockResolvedValue({ projects: [], fullProjects: [verifiedProject] });
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		const createCall = mockDockerCreateContainer.mock.calls[0]?.[0] as { Env: string[] };
		// snapshotReuse=false → the worker is NOT told to skip clone/install.
		expect(createCall.Env).not.toContain('CASCADE_SNAPSHOT_REUSE=true');
		// ...but it IS a snapshot-enabled run (workspace preserved for commit).
		expect(createCall.Env).toContain('CASCADE_SNAPSHOT_ENABLED=true');

		resolveWait();
	});

	it('falls back to the effective base (not the global) when a stale snapshot 404s', async () => {
		mockGetSnapshot.mockReturnValue({
			imageName: 'cascade-snapshot-proj-snap-card-snap:latest',
			projectId: 'proj-snap',
			workItemId: 'card-snap',
			createdAt: new Date(),
		});
		mockLoadProjectConfig.mockResolvedValue({ projects: [], fullProjects: [verifiedProject] });
		const staleImageError = Object.assign(
			new Error(
				'(HTTP code 404) no such container - No such image: cascade-snapshot-proj-snap-card-snap:latest',
			),
			{ statusCode: 404 },
		);
		mockDockerCreateContainer.mockRejectedValueOnce(staleImageError);
		const { resolveWait } = setupMockContainer();

		await spawnWorker(makeJob() as never);

		expect(mockInvalidateSnapshot).toHaveBeenCalledWith('proj-snap', 'card-snap');
		// Fallback launches the verified digest, NOT the global default.
		expect(mockDockerCreateContainer).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ Image: 'sha256:abc' }),
		);
		expect(mockDockerCreateContainer).not.toHaveBeenCalledWith(
			expect.objectContaining({ Image: 'base-worker:latest' }),
		);

		resolveWait();
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

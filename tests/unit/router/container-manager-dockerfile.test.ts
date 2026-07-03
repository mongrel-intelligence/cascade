import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Spec 023 / plan 2 — launch side for a DOCKERFILE-built worker image.
//
// A dockerfile-built image is pinned by its immutable LOCAL image ID and lives
// ONLY on the router daemon that built it (single-router-daemon constraint). So:
//  - a missing local-only base must NEVER trigger a registry pull — a pull can
//    never satisfy a purely-local image; fail loud + terminal instead.
//  - a missing NON-local (reference) base must still pull + retry (the guard
//    must not over-fire).
//  - snapshot reuse + snapshot-404 relaunch must target the built base and honor
//    local-only (relaunch on a local base must not pull).
//
// Exercised against a FABRICATED verified dockerfile config (status + local pin
// set directly): no build engine (ticket 3/5) nor set surface (ticket 4/5) yet.
// ---------------------------------------------------------------------------

const {
	mockDockerCreateContainer,
	mockDockerGetContainer,
	mockDockerListContainers,
	mockDockerPull,
	mockFollowProgress,
	mockLoadProjectConfig,
	mockGetSnapshot,
	mockInvalidateSnapshot,
	mockRegisterSnapshot,
} = vi.hoisted(() => ({
	mockDockerCreateContainer: vi.fn(),
	mockDockerGetContainer: vi.fn(),
	mockDockerListContainers: vi.fn(),
	mockDockerPull: vi.fn(),
	mockFollowProgress: vi.fn(),
	mockLoadProjectConfig: vi.fn().mockResolvedValue({ projects: [], fullProjects: [] }),
	mockGetSnapshot: vi.fn(),
	mockInvalidateSnapshot: vi.fn(),
	mockRegisterSnapshot: vi.fn(),
}));

vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		createContainer: mockDockerCreateContainer,
		getContainer: mockDockerGetContainer,
		listContainers: mockDockerListContainers,
		pull: mockDockerPull,
		modem: { followProgress: mockFollowProgress },
	})),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

vi.mock('../../../src/config/provider.js', () => ({
	findProjectByRepo: vi.fn(),
	getAllProjectCredentials: vi.fn(),
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

// Snapshot registry is mocked so getSnapshot / invalidateSnapshot are controllable
// without touching the real in-memory registry. worker-spawn-settings.ts reads
// getSnapshot; container-manager.ts reads invalidateSnapshot.
vi.mock('../../../src/router/snapshot-manager.js', () => ({
	getSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
	invalidateSnapshot: (...args: unknown[]) => mockInvalidateSnapshot(...args),
	registerSnapshot: (...args: unknown[]) => mockRegisterSnapshot(...args),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { getAllProjectCredentials } from '../../../src/config/provider.js';
import '../../../src/integrations/pm/trello/index.js';
import { detachAll, spawnWorker } from '../../../src/router/container-manager.js';
import type { CascadeJob } from '../../../src/router/queue.js';

const mockGetAllProjectCredentials = vi.mocked(getAllProjectCredentials);

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

function imageNotFound(image: string) {
	return Object.assign(new Error(`(HTTP code 404) no such container - No such image: ${image}`), {
		statusCode: 404,
	});
}

const DOCKERFILE_PROJECT = {
	id: 'df-proj',
	workerDockerfile: 'RUN echo hi',
	workerImageSource: 'dockerfile' as const,
	workerImageStatus: 'verified' as const,
	workerImageDigest: 'sha256:localbuilt',
};

const REFERENCE_PROJECT = {
	id: 'ref-proj',
	workerImage: 'ghcr.io/acme/worker:v3',
	workerImageSource: 'reference' as const,
	workerImageStatus: 'verified' as const,
	workerImageDigest: 'sha256:refdigest',
};

describe('container-manager — dockerfile launch (spec 023/2)', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockResolvedValue({});
		mockLoadProjectConfig.mockResolvedValue({ projects: [], fullProjects: [] });
		mockGetSnapshot.mockReturnValue(undefined);
		mockDockerPull.mockResolvedValue({} as never);
		mockFollowProgress.mockImplementation(((_stream: unknown, cb: (err: Error | null) => void) =>
			cb(null)) as never);
		mockDockerCreateContainer.mockReset();
		mockDockerPull.mockClear();
		mockFollowProgress.mockClear();
		mockInvalidateSnapshot.mockClear();
		detachAll();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		detachAll();
	});

	// --- single-daemon reachability guard ---

	it('throws a grep-stable terminal reachability error and does NOT pull when a local-only built image is missing', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [DOCKERFILE_PROJECT],
		});
		mockDockerCreateContainer.mockRejectedValue(imageNotFound('sha256:localbuilt'));

		await expect(
			spawnWorker(
				makeJob({
					id: 'job-df-missing',
					data: { type: 'trello', projectId: 'df-proj' } as CascadeJob,
				}) as never,
			),
		).rejects.toThrow(/built worker image not present on this router daemon/);

		// A pull can NEVER satisfy a purely-local image → the guard must not pull.
		expect(mockDockerPull).not.toHaveBeenCalled();
		// Fail-closed: never silently relaunch on the global default.
		expect(mockDockerCreateContainer).not.toHaveBeenCalledWith(
			expect.objectContaining({ Image: 'test-worker:latest' }),
		);
	});

	it('names the project + single-daemon constraint in the reachability error', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [DOCKERFILE_PROJECT],
		});
		mockDockerCreateContainer.mockRejectedValue(imageNotFound('sha256:localbuilt'));

		await expect(
			spawnWorker(
				makeJob({
					id: 'job-df-missing-msg',
					data: { type: 'trello', projectId: 'df-proj' } as CascadeJob,
				}) as never,
			),
		).rejects.toThrow(/df-proj/);
	});

	it('still pulls and retries when a NON-local (reference) base is missing — guard must not over-fire', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [REFERENCE_PROJECT],
		});
		mockDockerCreateContainer.mockRejectedValueOnce(imageNotFound('sha256:refdigest'));
		const { resolveWait } = setupMockContainer();

		await spawnWorker(
			makeJob({
				id: 'job-ref-pull',
				data: { type: 'trello', projectId: 'ref-proj' } as CascadeJob,
			}) as never,
		);

		// A reference base is registry-backed → pulled-on-missing then retried.
		expect(mockDockerPull).toHaveBeenCalledTimes(1);
		expect(mockDockerPull).toHaveBeenCalledWith('sha256:refdigest');
		expect(mockDockerCreateContainer).toHaveBeenCalledTimes(2);

		resolveWait();
	});

	// --- launches the built base, HostConfig posture unchanged ---

	it('launches a verified dockerfile project from its local image ID with an unchanged HostConfig posture', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [DOCKERFILE_PROJECT],
		});
		const { resolveWait } = setupMockContainer();

		await spawnWorker(
			makeJob({
				id: 'job-df-launch',
				data: { type: 'trello', projectId: 'df-proj' } as CascadeJob,
			}) as never,
		);

		const call = mockDockerCreateContainer.mock.calls[0]?.[0] as {
			Image: string;
			HostConfig: Record<string, unknown>;
		};
		expect(call.Image).toBe('sha256:localbuilt');
		// No new mounts / privileges: the HostConfig is exactly the standard posture.
		expect(call.HostConfig).toEqual({
			Memory: 512 * 1024 * 1024,
			MemorySwap: 512 * 1024 * 1024,
			NetworkMode: 'test-network',
			AutoRemove: true,
		});

		resolveWait();
	});

	// --- snapshot coexistence for a dockerfile-source project ---

	it('classifies a snapshot HIT as reuse against the built base (launches the snapshot image)', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ ...DOCKERFILE_PROJECT, snapshotEnabled: true }],
		});
		mockGetSnapshot.mockReturnValue({ imageName: 'cascade-snapshot-df-proj-mng-200:latest' });
		const { resolveWait } = setupMockContainer();

		await spawnWorker(
			makeJob({
				id: 'job-df-snap-hit',
				data: {
					type: 'trello',
					projectId: 'df-proj',
					workItemId: 'MNG-200',
				} as CascadeJob,
			}) as never,
		);

		const call = mockDockerCreateContainer.mock.calls[0]?.[0] as {
			Image: string;
			Env: string[];
		};
		// Snapshot image (≠ built base) is launched and classified as reuse.
		expect(call.Image).toBe('cascade-snapshot-df-proj-mng-200:latest');
		expect(call.Env).toContain('CASCADE_SNAPSHOT_REUSE=true');

		resolveWait();
	});

	it('classifies a snapshot MISS as NOT reuse: launches the built base directly with no reuse flag', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ ...DOCKERFILE_PROJECT, snapshotEnabled: true }],
		});
		mockGetSnapshot.mockReturnValue(undefined);
		const { resolveWait } = setupMockContainer();

		await spawnWorker(
			makeJob({
				id: 'job-df-snap-miss',
				data: {
					type: 'trello',
					projectId: 'df-proj',
					workItemId: 'MNG-201',
				} as CascadeJob,
			}) as never,
		);

		const call = mockDockerCreateContainer.mock.calls[0]?.[0] as {
			Image: string;
			Env: string[];
		};
		// workerImage === effectiveBaseImage (the built base) → NOT a reuse.
		expect(call.Image).toBe('sha256:localbuilt');
		expect(call.Env).not.toContain('CASCADE_SNAPSHOT_REUSE=true');
		expect(mockDockerPull).not.toHaveBeenCalled();

		resolveWait();
	});

	it('relaunches on the built base (no pull) when a reused snapshot image 404s for a dockerfile project', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ ...DOCKERFILE_PROJECT, snapshotEnabled: true }],
		});
		mockGetSnapshot.mockReturnValue({ imageName: 'cascade-snapshot-df-proj-mng-202:latest' });
		// First launch (snapshot image) 404s; the built-base relaunch succeeds.
		mockDockerCreateContainer.mockRejectedValueOnce(
			imageNotFound('cascade-snapshot-df-proj-mng-202:latest'),
		);
		const { resolveWait } = setupMockContainer();

		await spawnWorker(
			makeJob({
				id: 'job-df-snap-404',
				data: {
					type: 'trello',
					projectId: 'df-proj',
					workItemId: 'MNG-202',
				} as CascadeJob,
			}) as never,
		);

		expect(mockInvalidateSnapshot).toHaveBeenCalledWith('df-proj', 'MNG-202');
		// Relaunch targets the built base…
		const relaunch = mockDockerCreateContainer.mock.calls[1]?.[0] as { Image: string };
		expect(relaunch.Image).toBe('sha256:localbuilt');
		// …and MUST NOT pull — the built base is a local-only image.
		expect(mockDockerPull).not.toHaveBeenCalled();

		resolveWait();
	});

	it('does NOT pull and fails terminal when both the snapshot and the local-only built base are missing', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ ...DOCKERFILE_PROJECT, snapshotEnabled: true }],
		});
		mockGetSnapshot.mockReturnValue({ imageName: 'cascade-snapshot-df-proj-mng-203:latest' });
		// Snapshot 404 → invalidate → relaunch on built base which is ALSO missing.
		mockDockerCreateContainer.mockRejectedValueOnce(
			imageNotFound('cascade-snapshot-df-proj-mng-203:latest'),
		);
		mockDockerCreateContainer.mockRejectedValueOnce(imageNotFound('sha256:localbuilt'));

		await expect(
			spawnWorker(
				makeJob({
					id: 'job-df-snap-both-404',
					data: {
						type: 'trello',
						projectId: 'df-proj',
						workItemId: 'MNG-203',
					} as CascadeJob,
				}) as never,
			),
		).rejects.toThrow(/built worker image not present on this router daemon/);

		expect(mockInvalidateSnapshot).toHaveBeenCalledWith('df-proj', 'MNG-203');
		// Relaunch on a local-only base must never pull.
		expect(mockDockerPull).not.toHaveBeenCalled();
	});
});

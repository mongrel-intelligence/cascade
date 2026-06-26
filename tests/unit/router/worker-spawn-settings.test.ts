import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoggerInfo, mockLoadProjectConfig, mockGetSnapshot } = vi.hoisted(() => ({
	mockLoggerInfo: vi.fn(),
	mockLoadProjectConfig: vi.fn(),
	mockGetSnapshot: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: (...args: unknown[]) => mockLoggerInfo(...args),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../src/router/config.js', () => ({
	loadProjectConfig: (...args: unknown[]) => mockLoadProjectConfig(...args),
	routerConfig: {
		workerImage: 'base-worker:latest',
		workerTimeoutMs: 30 * 60 * 1000,
		snapshotEnabled: false,
		snapshotDefaultTtlMs: 24 * 60 * 60 * 1000,
	},
}));

vi.mock('../../../src/router/snapshot-manager.js', () => ({
	getSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
}));

import {
	buildWorkerContainerName,
	ROUTER_KILL_BUFFER_MS,
	resolveSpawnSettings,
	WorkerImageResolutionError,
} from '../../../src/router/worker-spawn-settings.js';

describe('worker-spawn-settings', () => {
	beforeEach(() => {
		mockLoggerInfo.mockClear();
		mockLoadProjectConfig.mockReset();
		mockGetSnapshot.mockReset();
	});

	it('has no Docker dependency', async () => {
		const source = await readFile('src/router/worker-spawn-settings.ts', 'utf8');

		expect(source).not.toContain('dockerode');
		expect(source).not.toContain('new Docker');
	});

	it('returns global defaults without loading project config when projectId is null', async () => {
		const settings = await resolveSpawnSettings(null, undefined, 'job-no-project');

		expect(settings).toEqual({
			snapshotEnabled: false,
			workerImage: 'base-worker:latest',
			effectiveBaseImage: 'base-worker:latest',
			containerTimeoutMs: 30 * 60 * 1000,
			snapshotTtlMs: 24 * 60 * 60 * 1000,
		});
		expect(mockLoadProjectConfig).not.toHaveBeenCalled();
	});

	// --- spec 022 / plan 2: effectiveBaseImage refactor (AC #1) ---

	it('effectiveBaseImage === routerConfig.workerImage when the project has no per-project image', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'plain-project', snapshotEnabled: false }],
		});

		const settings = await resolveSpawnSettings('plain-project', 'MNG-1', 'job-plain');

		// Pure no-op refactor: with no per-project image, both the launch image and
		// the effective base equal the global default.
		expect(settings.effectiveBaseImage).toBe('base-worker:latest');
		expect(settings.workerImage).toBe('base-worker:latest');
	});

	// --- spec 022 / plan 2: verified-digest resolution (AC #5) ---

	it('resolves workerImage + effectiveBaseImage to the digest for a verified project image', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'custom-img',
					snapshotEnabled: false,
					workerImage: 'ghcr.io/acme/custom-worker:v3',
					workerImageStatus: 'verified',
					workerImageDigest: 'sha256:abc',
				},
			],
		});

		const settings = await resolveSpawnSettings('custom-img', 'MNG-2', 'job-custom');

		expect(settings.workerImage).toBe('sha256:abc');
		expect(settings.effectiveBaseImage).toBe('sha256:abc');
	});

	it('layers a snapshot image on top of effectiveBaseImage for a verified project image', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'custom-img',
					snapshotEnabled: true,
					workerImage: 'ghcr.io/acme/custom-worker:v3',
					workerImageStatus: 'verified',
					workerImageDigest: 'sha256:abc',
				},
			],
		});
		mockGetSnapshot.mockReturnValue({
			imageName: 'cascade-snapshot-custom-img-mng-3:latest',
		});

		const settings = await resolveSpawnSettings('custom-img', 'MNG-3', 'job-custom-snap');

		// Snapshot substitution replaces the LAUNCH image but the effective base
		// stays pinned to the verified digest.
		expect(settings.workerImage).toBe('cascade-snapshot-custom-img-mng-3:latest');
		expect(settings.effectiveBaseImage).toBe('sha256:abc');
	});

	// --- spec 022 / plan 2: fail-closed on unverified (AC #4 partial) ---

	it('throws a terminal WorkerImageResolutionError for a pending project image (no global fallback)', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'pending-img',
					snapshotEnabled: false,
					workerImage: 'ghcr.io/acme/custom-worker:v3',
					workerImageStatus: 'pending',
					// no digest yet
				},
			],
		});

		await expect(resolveSpawnSettings('pending-img', 'MNG-4', 'job-pending')).rejects.toThrow(
			WorkerImageResolutionError,
		);
		await expect(resolveSpawnSettings('pending-img', 'MNG-4', 'job-pending')).rejects.toThrow(
			/not verified: pending-img status=pending/,
		);
	});

	it('throws for a failed project image and for a verified image missing its digest', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'failed-img',
					workerImage: 'ghcr.io/acme/custom-worker:v3',
					workerImageStatus: 'failed',
				},
			],
		});
		await expect(resolveSpawnSettings('failed-img', 'MNG-5', 'job-failed')).rejects.toThrow(
			WorkerImageResolutionError,
		);

		// Defensive: 'verified' status but no digest must also fail closed.
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'verified-no-digest',
					workerImage: 'ghcr.io/acme/custom-worker:v3',
					workerImageStatus: 'verified',
					workerImageDigest: '',
				},
			],
		});
		await expect(
			resolveSpawnSettings('verified-no-digest', 'MNG-6', 'job-no-digest'),
		).rejects.toThrow(WorkerImageResolutionError);
	});

	it('records projectWorkerImage, globalWorkerImage, and effectiveBaseImage in the resolved-settings log', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'custom-img',
					snapshotEnabled: false,
					workerImage: 'ghcr.io/acme/custom-worker:v3',
					workerImageStatus: 'verified',
					workerImageDigest: 'sha256:abc',
				},
			],
		});

		await resolveSpawnSettings('custom-img', 'MNG-7', 'job-log');

		expect(mockLoggerInfo).toHaveBeenCalledWith(
			'[WorkerManager] Resolved spawn settings:',
			expect.objectContaining({
				projectWorkerImage: 'ghcr.io/acme/custom-worker:v3',
				globalWorkerImage: 'base-worker:latest',
				effectiveBaseImage: 'sha256:abc',
				workerImage: 'sha256:abc',
			}),
		);
	});

	it('logs projectWorkerImage=null when the project has no per-project image', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'plain-project', snapshotEnabled: false }],
		});

		await resolveSpawnSettings('plain-project', 'MNG-8', 'job-plain-log');

		expect(mockLoggerInfo).toHaveBeenCalledWith(
			'[WorkerManager] Resolved spawn settings:',
			expect.objectContaining({
				projectWorkerImage: null,
				globalWorkerImage: 'base-worker:latest',
				effectiveBaseImage: 'base-worker:latest',
			}),
		);
	});

	it('adds the router kill buffer to a per-project watchdog timeout', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'ucho',
					watchdogTimeoutMs: 45 * 60 * 1000,
					snapshotEnabled: false,
				},
			],
		});

		const settings = await resolveSpawnSettings('ucho', 'MNG-308', 'job-ucho-1');

		expect(ROUTER_KILL_BUFFER_MS).toBe(2 * 60 * 1000);
		expect(settings.containerTimeoutMs).toBe(47 * 60 * 1000);
		expect(mockLoggerInfo).toHaveBeenCalledWith(
			'[WorkerManager] Resolved spawn settings:',
			expect.objectContaining({
				jobId: 'job-ucho-1',
				projectId: 'ucho',
				workItemId: 'MNG-308',
				containerTimeoutMs: 47 * 60 * 1000,
				containerTimeoutMinutes: 47,
				projectWatchdogTimeoutMs: 45 * 60 * 1000,
				globalWorkerTimeoutMs: 30 * 60 * 1000,
			}),
		);
	});

	it('uses a valid snapshot image when project snapshots are enabled and metadata exists', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'snapshot-project',
					snapshotEnabled: true,
					snapshotTtlMs: 10_000,
				},
			],
		});
		mockGetSnapshot.mockReturnValue({
			imageName: 'cascade-snapshot-snapshot-project-mng-650:latest',
		});

		const settings = await resolveSpawnSettings('snapshot-project', 'MNG-650', 'job-snapshot');

		expect(mockGetSnapshot).toHaveBeenCalledWith('snapshot-project', 'MNG-650', 10_000);
		expect(settings).toMatchObject({
			snapshotEnabled: true,
			workerImage: 'cascade-snapshot-snapshot-project-mng-650:latest',
			snapshotTtlMs: 10_000,
		});
		expect(mockLoggerInfo).toHaveBeenCalledWith(
			'[WorkerManager] Snapshot hit — using snapshot image:',
			expect.objectContaining({
				jobId: 'job-snapshot',
				imageName: 'cascade-snapshot-snapshot-project-mng-650:latest',
			}),
		);
	});

	it('falls back to the base image when snapshots are enabled but no metadata exists', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'snapshot-miss', snapshotEnabled: true }],
		});
		mockGetSnapshot.mockReturnValue(undefined);

		const settings = await resolveSpawnSettings('snapshot-miss', 'MNG-651', 'job-miss');

		expect(settings.workerImage).toBe('base-worker:latest');
		expect(settings.snapshotEnabled).toBe(true);
		expect(mockLoggerInfo).toHaveBeenCalledWith(
			'[WorkerManager] Snapshot miss — using base worker image:',
			expect.objectContaining({
				jobId: 'job-miss',
				projectId: 'snapshot-miss',
				workItemId: 'MNG-651',
			}),
		);
	});

	it('builds Docker-safe worker container names from coalesced job IDs', () => {
		expect(buildWorkerContainerName('coalesce:ucho:MNG-413')).toBe(
			'cascade-worker-coalesce_ucho_MNG-413',
		);
	});

	it('passes through Docker-safe worker job IDs unchanged', () => {
		expect(buildWorkerContainerName('github-1234567890abcdef')).toBe(
			'cascade-worker-github-1234567890abcdef',
		);
	});
});

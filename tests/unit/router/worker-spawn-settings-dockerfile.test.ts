import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Spec 023 / plan 2 — spawn resolution for a DOCKERFILE-built worker image.
//
// A dockerfile-sourced project launches by its immutable LOCAL image ID (held
// in `worker_image_digest`), NOT by a registry digest. The image lives only on
// the router daemon that built it, so resolution marks it `localOnly` and the
// launch path must never pull it (guard lives in container-manager). These
// tests exercise `resolveSpawnSettings` against a FABRICATED dockerfile config
// (status + local pin set directly) because no build engine (ticket 3/5) nor
// set surface (ticket 4/5) exists yet — dormant-but-tested.
// ---------------------------------------------------------------------------

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
	resolveSpawnSettings,
	WorkerImageResolutionError,
} from '../../../src/router/worker-spawn-settings.js';

describe('worker-spawn-settings — dockerfile source (spec 023/2)', () => {
	beforeEach(() => {
		mockLoggerInfo.mockClear();
		mockLoadProjectConfig.mockReset();
		mockGetSnapshot.mockReset();
		mockGetSnapshot.mockReturnValue(undefined);
	});

	// --- verified dockerfile → local pin, marked local-only ---

	it('resolves a verified dockerfile source to its local image ID, marked local-only', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'df-proj',
					snapshotEnabled: false,
					workerDockerfile: 'RUN echo hi',
					workerImageSource: 'dockerfile',
					workerImageStatus: 'verified',
					// A built image is pinned by its immutable LOCAL image ID, not a
					// registry digest. The local ID lives in worker_image_digest.
					workerImageDigest:
						'sha256:localbuilt0000000000000000000000000000000000000000000000000000',
				},
			],
		});

		const settings = await resolveSpawnSettings('df-proj', 'MNG-100', 'job-df');

		expect(settings.effectiveBaseImage).toBe(
			'sha256:localbuilt0000000000000000000000000000000000000000000000000000',
		);
		expect(settings.workerImage).toBe(
			'sha256:localbuilt0000000000000000000000000000000000000000000000000000',
		);
		expect(settings.effectiveBaseImageLocalOnly).toBe(true);
		expect(settings.workerImageSource).toBe('dockerfile');
	});

	it('layers a snapshot image on top of a verified dockerfile base but keeps local-only + built base', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'df-proj',
					snapshotEnabled: true,
					workerDockerfile: 'RUN echo hi',
					workerImageSource: 'dockerfile',
					workerImageStatus: 'verified',
					workerImageDigest: 'sha256:localbuilt',
				},
			],
		});
		mockGetSnapshot.mockReturnValue({ imageName: 'cascade-snapshot-df-proj-mng-101:latest' });

		const settings = await resolveSpawnSettings('df-proj', 'MNG-101', 'job-df-snap');

		// Snapshot substitution replaces the LAUNCH image; the effective base stays
		// pinned to the local built image and remains flagged local-only.
		expect(settings.workerImage).toBe('cascade-snapshot-df-proj-mng-101:latest');
		expect(settings.effectiveBaseImage).toBe('sha256:localbuilt');
		expect(settings.effectiveBaseImageLocalOnly).toBe(true);
		expect(settings.workerImageSource).toBe('dockerfile');
	});

	// --- not-verified dockerfile → throws terminal, never the global default ---

	it.each([
		'pending',
		'building',
		'failed',
	])('throws a terminal WorkerImageResolutionError for a %s dockerfile source (never the global default)', async (status) => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'df-unready',
					snapshotEnabled: false,
					workerDockerfile: 'RUN echo hi',
					workerImageSource: 'dockerfile',
					workerImageStatus: status,
					// No runnable local pin while the build is pending/building/failed.
				},
			],
		});

		await expect(resolveSpawnSettings('df-unready', 'MNG-102', 'job-df-unready')).rejects.toThrow(
			WorkerImageResolutionError,
		);
		await expect(resolveSpawnSettings('df-unready', 'MNG-102', 'job-df-unready')).rejects.toThrow(
			/not verified: df-unready status=/,
		);
	});

	it('throws for a verified dockerfile source missing its local pin (empty digest)', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'df-no-pin',
					snapshotEnabled: false,
					workerDockerfile: 'RUN echo hi',
					workerImageSource: 'dockerfile',
					workerImageStatus: 'verified',
					workerImageDigest: '',
				},
			],
		});

		await expect(resolveSpawnSettings('df-no-pin', 'MNG-103', 'job-df-no-pin')).rejects.toThrow(
			WorkerImageResolutionError,
		);
	});

	// --- default / reference resolution unchanged + NOT local-only ---

	it('leaves default (no per-project image) resolution unchanged and NOT local-only', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'plain', snapshotEnabled: false, workerImageSource: 'default' }],
		});

		const settings = await resolveSpawnSettings('plain', 'MNG-104', 'job-plain');

		expect(settings.effectiveBaseImage).toBe('base-worker:latest');
		expect(settings.workerImage).toBe('base-worker:latest');
		expect(settings.effectiveBaseImageLocalOnly).toBe(false);
		expect(settings.workerImageSource).toBe('default');
	});

	it('leaves reference (registry digest) resolution unchanged and NOT local-only', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'ref-proj',
					snapshotEnabled: false,
					workerImage: 'ghcr.io/acme/worker:v3',
					workerImageSource: 'reference',
					workerImageStatus: 'verified',
					workerImageDigest: 'sha256:refdigest',
				},
			],
		});

		const settings = await resolveSpawnSettings('ref-proj', 'MNG-105', 'job-ref');

		expect(settings.effectiveBaseImage).toBe('sha256:refdigest');
		expect(settings.workerImage).toBe('sha256:refdigest');
		expect(settings.effectiveBaseImageLocalOnly).toBe(false);
		expect(settings.workerImageSource).toBe('reference');
	});

	it('returns defaults with effectiveBaseImageLocalOnly=false + workerImageSource=default when projectId is null', async () => {
		const settings = await resolveSpawnSettings(null, undefined, 'job-no-project');

		expect(settings.effectiveBaseImageLocalOnly).toBe(false);
		expect(settings.workerImageSource).toBe('default');
		expect(settings.effectiveBaseImage).toBe('base-worker:latest');
		expect(mockLoadProjectConfig).not.toHaveBeenCalled();
	});

	// --- log line includes the new fields (operator confirmation) ---

	it('records workerImageSource + effectiveBaseImageLocalOnly + the effective image in the resolved-settings log', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'df-proj',
					snapshotEnabled: false,
					workerDockerfile: 'RUN echo hi',
					workerImageSource: 'dockerfile',
					workerImageStatus: 'verified',
					workerImageDigest: 'sha256:localbuilt',
				},
			],
		});

		await resolveSpawnSettings('df-proj', 'MNG-106', 'job-df-log');

		expect(mockLoggerInfo).toHaveBeenCalledWith(
			'[WorkerManager] Resolved spawn settings:',
			expect.objectContaining({
				workerImageSource: 'dockerfile',
				effectiveBaseImageLocalOnly: true,
				effectiveBaseImage: 'sha256:localbuilt',
				workerImage: 'sha256:localbuilt',
			}),
		);
	});
});

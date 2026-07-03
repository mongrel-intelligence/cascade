import { beforeEach, describe, expect, it, vi } from 'vitest';

// The handler uses dependency injection; the heavy modules it imports are mocked
// only to keep module load Docker-/DB-free. Behavior is driven through injected
// `deps`. The pure compose module is NOT mocked — the reuse fast-path depends on
// the real full-hash so the tests exercise it end-to-end.
vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		getImage: vi.fn(),
		buildImage: vi.fn(),
		modem: { followProgress: vi.fn() },
	})),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		workerImage: 'ghcr.io/acme/cascade-worker:latest',
		workerBuildTimeoutMs: 600_000,
		dockerNetwork: 'test-network',
		workerMemoryMb: 512,
	},
}));

vi.mock('../../../src/router/worker-snapshots.js', () => ({
	pullImageOnce: vi.fn(),
	isImageNotFoundError: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/router/worker-image-validation.js', () => ({
	resolveDigestFromRepoDigests: vi.fn(),
	runWorkerImageSmokeTest: vi.fn(),
}));

vi.mock('../../../src/db/repositories/projectsRepository.js', () => ({
	readWorkerImageBuildInputs: vi.fn(),
	recordWorkerImageBuildResult: vi.fn(),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

const { mockLogger } = vi.hoisted(() => ({
	mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));

import {
	composeDockerfile,
	computeContentHash,
	computeFullBuildHash,
} from '../../../src/router/worker-dockerfile-compose.js';
import {
	builtImageTag,
	createSingleFileTar,
	handleWorkerImageBuild,
	type WorkerImageBuildDeps,
} from '../../../src/router/worker-image-build.js';

const PROJECT_ID = 'proj-1';
const DOCKERFILE = 'RUN apt-get install -y jq';
const CONTENT_HASH = computeContentHash(DOCKERFILE);
const BASE_DIGEST = 'ghcr.io/acme/cascade-worker@sha256:base';
const COMPOSED = composeDockerfile(DOCKERFILE, BASE_DIGEST);
const FULL_HASH = computeFullBuildHash(COMPOSED, BASE_DIGEST);
const TAG = 'cascade-built-proj-1:latest';
const PAYLOAD = { projectId: PROJECT_ID, buildHash: CONTENT_HASH };

function makeDeps(overrides: Partial<WorkerImageBuildDeps> = {}): WorkerImageBuildDeps {
	return {
		readInputs: vi.fn().mockResolvedValue({
			dockerfile: DOCKERFILE,
			buildHash: CONTENT_HASH,
			workerImageStatus: null,
			workerImageDigest: null,
		}),
		resolveBaseDigest: vi.fn().mockResolvedValue(BASE_DIGEST),
		buildImage: vi.fn().mockResolvedValue(undefined),
		inspectBuiltImage: vi.fn().mockResolvedValue(null),
		runImageCheck: vi
			.fn()
			.mockResolvedValue({ exitCode: 0, output: 'cascade-worker-image-checks OK' }),
		recordResult: vi.fn().mockResolvedValue(true),
		captureException: vi.fn(),
		workerBuildTimeoutMs: 600_000,
		...overrides,
	};
}

/** Convenience: read the single recordResult call's `(projectId, buildHash, result)`. */
function recordedResult(deps: WorkerImageBuildDeps) {
	const calls = (deps.recordResult as ReturnType<typeof vi.fn>).mock.calls;
	return calls[0];
}

describe('builtImageTag', () => {
	it('builds a stable per-project :latest tag', () => {
		expect(builtImageTag('proj-1')).toBe('cascade-built-proj-1:latest');
	});

	it('sanitises non-alphanumeric characters so any projectId is a valid Docker tag', () => {
		expect(builtImageTag('Org/Proj_42')).toBe('cascade-built-org-proj-42:latest');
	});
});

describe('createSingleFileTar', () => {
	it('produces a 512-byte-block-aligned ustar archive containing the file name and content', () => {
		const tar = createSingleFileTar('Dockerfile', 'FROM scratch\n');
		expect(tar.length % 512).toBe(0);
		expect(tar.subarray(0, 10).toString('utf-8')).toContain('Dockerfile');
		expect(tar.subarray(257, 262).toString('utf-8')).toBe('ustar');
		expect(tar.toString('utf-8')).toContain('FROM scratch');
	});
});

describe('handleWorkerImageBuild', () => {
	beforeEach(() => {
		mockLogger.info.mockClear();
		mockLogger.warn.mockClear();
		mockLogger.error.mockClear();
	});

	it('composes onto the pinned base, builds the tagged image, pins its local ID, and marks verified', async () => {
		const deps = makeDeps({
			inspectBuiltImage: vi
				.fn()
				.mockResolvedValueOnce(null) // reuse check — miss
				.mockResolvedValueOnce({ id: 'sha256:built', fullHash: FULL_HASH }), // pin
		});

		await handleWorkerImageBuild(PAYLOAD, deps);

		expect(deps.buildImage).toHaveBeenCalledWith({
			dockerfile: COMPOSED,
			tag: TAG,
			fullHash: FULL_HASH,
		});
		expect(deps.recordResult).toHaveBeenCalledWith(PROJECT_ID, CONTENT_HASH, {
			status: 'verified',
			digest: 'sha256:built',
			error: null,
		});
	});

	it('runs the smoke-test against the immutable pin (image ID), not the retag-able tag', async () => {
		const deps = makeDeps({
			inspectBuiltImage: vi
				.fn()
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ id: 'sha256:built', fullHash: FULL_HASH }),
		});

		await handleWorkerImageBuild(PAYLOAD, deps);

		expect(deps.runImageCheck).toHaveBeenCalledWith('sha256:built');
	});

	it('drops a superseded build (DB build hash no longer matches the job) without building', async () => {
		const deps = makeDeps({
			readInputs: vi.fn().mockResolvedValue({
				dockerfile: DOCKERFILE,
				buildHash: 'a-newer-hash',
				workerImageStatus: null,
				workerImageDigest: null,
			}),
		});

		await handleWorkerImageBuild(PAYLOAD, deps);

		expect(deps.buildImage).not.toHaveBeenCalled();
		expect(deps.recordResult).not.toHaveBeenCalled();
		expect(mockLogger.info).toHaveBeenCalledWith(
			'[worker-image-build] superseded — build hash changed, dropping',
			expect.any(Object),
		);
	});

	it('drops when the project no longer exists', async () => {
		const deps = makeDeps({ readInputs: vi.fn().mockResolvedValue(null) });

		await handleWorkerImageBuild(PAYLOAD, deps);

		expect(deps.buildImage).not.toHaveBeenCalled();
		expect(deps.recordResult).not.toHaveBeenCalled();
	});

	it('marks failed with a build failed: reason on a docker build failure', async () => {
		const deps = makeDeps({
			buildImage: vi.fn().mockRejectedValue(new Error('layer 3 RUN returned a non-zero code')),
		});

		await handleWorkerImageBuild(PAYLOAD, deps);

		const [projectId, buildHash, result] = recordedResult(deps);
		expect(projectId).toBe(PROJECT_ID);
		expect(buildHash).toBe(CONTENT_HASH);
		expect(result.status).toBe('failed');
		expect(result.error).toMatch(/^build failed:/);
		expect(result.error).toContain('layer 3 RUN');
		// Smoke-test is never reached when the build fails.
		expect(deps.runImageCheck).not.toHaveBeenCalled();
	});

	it('marks failed with a DISTINCT runtime requirement missing: reason on a smoke-test non-zero exit', async () => {
		const deps = makeDeps({
			inspectBuiltImage: vi
				.fn()
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ id: 'sha256:built', fullHash: FULL_HASH }),
			runImageCheck: vi
				.fn()
				.mockResolvedValue({ exitCode: 1, output: 'FAIL: cascade-tools check failed' }),
		});

		await handleWorkerImageBuild(PAYLOAD, deps);

		const [, , result] = recordedResult(deps);
		expect(result.status).toBe('failed');
		expect(result.error).toMatch(/^runtime requirement missing/);
		expect(result.error).not.toMatch(/^build failed:/);
		expect(result.error).toContain('cascade-tools');
	});

	it('marks failed on a self-declared FROM (compose error) without building', async () => {
		const deps = makeDeps({
			readInputs: vi.fn().mockResolvedValue({
				dockerfile: 'FROM alpine:3\nRUN true',
				buildHash: CONTENT_HASH,
				workerImageStatus: null,
				workerImageDigest: null,
			}),
		});

		await handleWorkerImageBuild(PAYLOAD, deps);

		const [, , result] = recordedResult(deps);
		expect(result.status).toBe('failed');
		expect(result.error).toMatch(/^build failed:/);
		expect(result.error).toContain('FROM');
		expect(deps.buildImage).not.toHaveBeenCalled();
	});

	it('marks failed when the built image cannot be inspected to pin its local ID', async () => {
		const deps = makeDeps({
			inspectBuiltImage: vi
				.fn()
				.mockResolvedValueOnce(null) // reuse miss
				.mockResolvedValueOnce(null), // pin inspect — gone
		});

		await handleWorkerImageBuild(PAYLOAD, deps);

		const [, , result] = recordedResult(deps);
		expect(result.status).toBe('failed');
		expect(result.error).toMatch(/^build failed:/);
		expect(deps.runImageCheck).not.toHaveBeenCalled();
	});

	it('resolves to failed on a wall-clock build timeout (never left building)', async () => {
		const deps = makeDeps({
			// A build that never settles within the budget.
			buildImage: vi.fn().mockImplementation(() => new Promise<void>(() => {})),
			workerBuildTimeoutMs: 25,
		});

		await expect(handleWorkerImageBuild(PAYLOAD, deps)).resolves.toBeUndefined();

		const [, , result] = recordedResult(deps);
		expect(result.status).toBe('failed');
		expect(result.error).toMatch(/^build failed:/);
		expect(result.error).toContain('timed out');
	});

	it('keeps the last-good verified pin (keepActive) when a rebuild fails and a prior verified image exists', async () => {
		const deps = makeDeps({
			readInputs: vi.fn().mockResolvedValue({
				dockerfile: DOCKERFILE,
				buildHash: CONTENT_HASH,
				workerImageStatus: 'verified',
				workerImageDigest: 'sha256:last-good',
			}),
			buildImage: vi.fn().mockRejectedValue(new Error('apt-get 404')),
		});

		await handleWorkerImageBuild(PAYLOAD, deps);

		const [, , result] = recordedResult(deps);
		expect(result).toEqual({
			status: 'failed',
			error: expect.stringMatching(/^build failed:/),
			keepActive: true,
		});
	});

	it('marks a FIRST build failure with keepActive:false (no prior verified image to preserve)', async () => {
		const deps = makeDeps({
			readInputs: vi.fn().mockResolvedValue({
				dockerfile: DOCKERFILE,
				buildHash: CONTENT_HASH,
				workerImageStatus: 'building',
				workerImageDigest: null,
			}),
			buildImage: vi.fn().mockRejectedValue(new Error('boom')),
		});

		await handleWorkerImageBuild(PAYLOAD, deps);

		const [, , result] = recordedResult(deps);
		expect(result.keepActive).toBe(false);
	});

	it('reuses an intact local image with a matching full-hash label — skips docker build', async () => {
		const deps = makeDeps({
			inspectBuiltImage: vi.fn().mockResolvedValue({ id: 'sha256:reused', fullHash: FULL_HASH }),
		});

		await handleWorkerImageBuild(PAYLOAD, deps);

		expect(deps.buildImage).not.toHaveBeenCalled();
		expect(deps.runImageCheck).toHaveBeenCalledWith('sha256:reused');
		expect(deps.recordResult).toHaveBeenCalledWith(PROJECT_ID, CONTENT_HASH, {
			status: 'verified',
			digest: 'sha256:reused',
			error: null,
		});
	});

	it('rebuilds when the local image label does NOT match the full-hash (stale reuse candidate)', async () => {
		const deps = makeDeps({
			inspectBuiltImage: vi
				.fn()
				.mockResolvedValueOnce({ id: 'sha256:stale', fullHash: 'a-different-full-hash' })
				.mockResolvedValueOnce({ id: 'sha256:fresh', fullHash: FULL_HASH }),
		});

		await handleWorkerImageBuild(PAYLOAD, deps);

		expect(deps.buildImage).toHaveBeenCalledTimes(1);
		expect(deps.runImageCheck).toHaveBeenCalledWith('sha256:fresh');
	});

	it('catches any unexpected error, records failed, and Sentry-captures under worker_image_build (never rejects)', async () => {
		const deps = makeDeps({
			resolveBaseDigest: vi.fn().mockRejectedValue(new Error('docker daemon gone')),
		});

		await expect(handleWorkerImageBuild(PAYLOAD, deps)).resolves.toBeUndefined();

		const [, , result] = recordedResult(deps);
		expect(result.status).toBe('failed');
		expect(result.error).toContain('docker daemon gone');
		expect(deps.captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ tags: expect.objectContaining({ source: 'worker_image_build' }) }),
		);
	});

	it('drops a stale verified result without error when the build hash changed mid-build (recordResult false)', async () => {
		const deps = makeDeps({
			inspectBuiltImage: vi
				.fn()
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ id: 'sha256:built', fullHash: FULL_HASH }),
			recordResult: vi.fn().mockResolvedValue(false),
		});

		await expect(handleWorkerImageBuild(PAYLOAD, deps)).resolves.toBeUndefined();

		expect(mockLogger.info).toHaveBeenCalledWith(
			'[worker-image-build] skipped stale result (build hash changed)',
			expect.any(Object),
		);
	});

	it('records verified with the NEW pin on a successful rebuild over a prior verified image', async () => {
		const deps = makeDeps({
			readInputs: vi.fn().mockResolvedValue({
				dockerfile: DOCKERFILE,
				buildHash: CONTENT_HASH,
				workerImageStatus: 'verified',
				workerImageDigest: 'sha256:old',
			}),
			inspectBuiltImage: vi
				.fn()
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ id: 'sha256:new', fullHash: FULL_HASH }),
		});

		await handleWorkerImageBuild(PAYLOAD, deps);

		expect(deps.recordResult).toHaveBeenCalledWith(PROJECT_ID, CONTENT_HASH, {
			status: 'verified',
			digest: 'sha256:new',
			error: null,
		});
	});
});

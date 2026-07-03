import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unit tests for the base-digest resolution decision helper (MNG-1731). The
// helper takes injectable `pull()` + `inspectLocal()` functions so the branching
// is exercised without a live Docker daemon. Heavy modules are mocked only to keep
// module load Docker-/DB-free; `worker-image-validation.js` is intentionally NOT
// mocked so the REAL `resolveDigestFromRepoDigests` runs (the helper's primary
// path depends on it).
vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		getImage: vi.fn(),
		buildImage: vi.fn(),
		pull: vi.fn(),
		run: vi.fn(),
		modem: { followProgress: vi.fn() },
	})),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		workerImage: 'ghcr.io/acme/cascade-worker:dev',
		workerBuildTimeoutMs: 600_000,
		dockerNetwork: 'test-network',
		workerMemoryMb: 512,
	},
}));

vi.mock('../../../src/router/worker-snapshots.js', () => ({
	pullImageOnce: vi.fn(),
	isImageNotFoundError: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/db/repositories/projectsRepository.js', () => ({
	readWorkerImageBuildInputs: vi.fn(),
	recordWorkerImageBuildResult: vi.fn(),
	recordWorkerImageValidationResult: vi.fn(),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

const { mockLogger } = vi.hoisted(() => ({
	mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../src/utils/logging.js', () => ({ logger: mockLogger }));

import {
	type LocalImageInspect,
	resolveBaseImageRef,
} from '../../../src/router/worker-image-build.js';

const REF = 'ghcr.io/acme/cascade-worker:dev';
const REGISTRY_DIGEST = 'ghcr.io/acme/cascade-worker@sha256:registrydigest';
const LOCAL_IMAGE_ID = 'sha256:localimageid0000000000000000000000000000000000000000000000000000';

/** A 401 Docker pull error, shaped like the dockerode HTTP error the dev daemon throws. */
function make401(): Error {
	return new Error(
		'(HTTP code 401) unexpected - Head "https://ghcr.io/v2/acme/cascade-worker/manifests/dev": unauthorized',
	);
}

describe('resolveBaseImageRef', () => {
	beforeEach(() => {
		mockLogger.info.mockClear();
		mockLogger.warn.mockClear();
		mockLogger.error.mockClear();
	});

	it('pull SUCCEEDS + RepoDigests present → returns the registry digest (unchanged primary path)', async () => {
		const pull = vi.fn().mockResolvedValue(undefined);
		const inspectLocal = vi.fn().mockResolvedValue({
			Id: LOCAL_IMAGE_ID,
			RepoDigests: [REGISTRY_DIGEST],
		} satisfies LocalImageInspect);

		const result = await resolveBaseImageRef(REF, { pull, inspectLocal });

		expect(result).toBe(REGISTRY_DIGEST);
		expect(pull).toHaveBeenCalledTimes(1);
		expect(inspectLocal).toHaveBeenCalledTimes(1);
		// A clean pull must not emit the fallback warning.
		expect(mockLogger.warn).not.toHaveBeenCalled();
	});

	it('pull THROWS (401) + image present locally WITH RepoDigests → returns the local registry digest, does NOT rethrow (dev regression)', async () => {
		const pull = vi.fn().mockRejectedValue(make401());
		const inspectLocal = vi.fn().mockResolvedValue({
			Id: LOCAL_IMAGE_ID,
			RepoDigests: [REGISTRY_DIGEST],
		} satisfies LocalImageInspect);

		const result = await resolveBaseImageRef(REF, { pull, inspectLocal });

		expect(result).toBe(REGISTRY_DIGEST);
		expect(inspectLocal).toHaveBeenCalledTimes(1);
		// The fallback is observable in the logs so operators can see the pull failed.
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'[worker-image-build] base-image registry pull failed; resolving from the local base image',
			expect.objectContaining({ ref: REF }),
		);
	});

	it('pull THROWS + image present locally with NO RepoDigests → returns the local image-ID pin (self-hosted path)', async () => {
		const pull = vi.fn().mockRejectedValue(make401());
		const inspectLocal = vi
			.fn()
			.mockResolvedValue({ Id: LOCAL_IMAGE_ID, RepoDigests: [] } satisfies LocalImageInspect);

		const result = await resolveBaseImageRef(REF, { pull, inspectLocal });

		expect(result).toBe(LOCAL_IMAGE_ID);
		expect(mockLogger.warn).toHaveBeenCalledTimes(1);
	});

	it('pull THROWS + image present locally with undefined RepoDigests → still returns the local image-ID pin', async () => {
		const pull = vi.fn().mockRejectedValue(new Error('ENOTFOUND registry.internal'));
		const inspectLocal = vi
			.fn()
			.mockResolvedValue({ Id: LOCAL_IMAGE_ID } satisfies LocalImageInspect);

		const result = await resolveBaseImageRef(REF, { pull, inspectLocal });

		expect(result).toBe(LOCAL_IMAGE_ID);
	});

	it('pull THROWS + image ABSENT locally → rethrows a clear, greppable "cannot obtain base image" error', async () => {
		const pull = vi.fn().mockRejectedValue(make401());
		const inspectLocal = vi.fn().mockRejectedValue(
			Object.assign(new Error('No such image: ghcr.io/acme/cascade-worker:dev'), {
				statusCode: 404,
			}),
		);

		await expect(resolveBaseImageRef(REF, { pull, inspectLocal })).rejects.toThrow(
			/cannot obtain base image ghcr\.io\/acme\/cascade-worker:dev/,
		);
		// The error must fold in the pull failure so a triage grep sees the 401.
		await expect(resolveBaseImageRef(REF, { pull, inspectLocal })).rejects.toThrow(/401/);
	});

	it('pull SUCCEEDS but inspect throws (image vanished after pull) → surfaces the inspect error, NOT the cannot-obtain error', async () => {
		const pull = vi.fn().mockResolvedValue(undefined);
		const inspectLocal = vi.fn().mockRejectedValue(new Error('daemon race: image gone'));

		await expect(resolveBaseImageRef(REF, { pull, inspectLocal })).rejects.toThrow(
			/daemon race: image gone/,
		);
		await expect(resolveBaseImageRef(REF, { pull, inspectLocal })).rejects.not.toThrow(
			/cannot obtain base image/,
		);
	});

	it('local image has neither RepoDigests nor an image ID → throws the clear cannot-pin error', async () => {
		const pull = vi.fn().mockResolvedValue(undefined);
		const inspectLocal = vi.fn().mockResolvedValue({} satisfies LocalImageInspect);

		await expect(resolveBaseImageRef(REF, { pull, inspectLocal })).rejects.toThrow(
			/cannot obtain base image .*neither RepoDigests nor an image ID/,
		);
	});

	it('prefers the RepoDigests entry whose repository matches the ref (delegates to resolveDigestFromRepoDigests)', async () => {
		const matching = 'ghcr.io/acme/cascade-worker@sha256:matchingdigest';
		const pull = vi.fn().mockResolvedValue(undefined);
		const inspectLocal = vi.fn().mockResolvedValue({
			Id: LOCAL_IMAGE_ID,
			RepoDigests: ['ghcr.io/other/image@sha256:otherdigest', matching],
		} satisfies LocalImageInspect);

		const result = await resolveBaseImageRef(REF, { pull, inspectLocal });

		expect(result).toBe(matching);
	});
});

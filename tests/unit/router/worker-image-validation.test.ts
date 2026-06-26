import { beforeEach, describe, expect, it, vi } from 'vitest';

// The handler uses dependency injection, so the heavy modules it imports are
// mocked only to keep module load Docker-/DB-free; the actual behavior is driven
// through the injected `deps`.
vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		getImage: vi.fn(),
		run: vi.fn(),
	})),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		dockerNetwork: 'test-network',
		workerMemoryMb: 512,
	},
}));

vi.mock('../../../src/router/worker-snapshots.js', () => ({
	pullImageOnce: vi.fn(),
}));

vi.mock('../../../src/db/repositories/projectsRepository.js', () => ({
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
	handleWorkerImageValidation,
	resolveDigestFromRepoDigests,
	type WorkerImageValidationDeps,
} from '../../../src/router/worker-image-validation.js';

function makeDeps(overrides: Partial<WorkerImageValidationDeps> = {}): WorkerImageValidationDeps {
	return {
		pullImage: vi.fn().mockResolvedValue(undefined),
		inspectImageDigest: vi.fn().mockResolvedValue('ghcr.io/acme/cascade-worker@sha256:abc123'),
		runImageCheck: vi
			.fn()
			.mockResolvedValue({ exitCode: 0, output: 'cascade-worker-image-checks OK' }),
		recordResult: vi.fn().mockResolvedValue(true),
		captureException: vi.fn(),
		...overrides,
	};
}

const PAYLOAD = { projectId: 'proj-1', ref: 'ghcr.io/acme/cascade-worker:latest' };

describe('resolveDigestFromRepoDigests', () => {
	it('returns the full repo@sha256 entry matching the pulled repository (launchable digest)', () => {
		const digest = resolveDigestFromRepoDigests('ghcr.io/acme/cascade-worker:latest', [
			'ghcr.io/acme/cascade-worker@sha256:abc123',
		]);
		expect(digest).toBe('ghcr.io/acme/cascade-worker@sha256:abc123');
	});

	it('prefers the RepoDigests entry whose repository matches the ref', () => {
		const digest = resolveDigestFromRepoDigests('ghcr.io/acme/cascade-worker:v2', [
			'docker.io/other/image@sha256:zzz',
			'ghcr.io/acme/cascade-worker@sha256:match',
		]);
		expect(digest).toBe('ghcr.io/acme/cascade-worker@sha256:match');
	});

	it('returns null when there are no RepoDigests', () => {
		expect(resolveDigestFromRepoDigests('repo:latest', [])).toBeNull();
	});

	it('keeps a registry port intact when stripping the tag', () => {
		const digest = resolveDigestFromRepoDigests('registry:5000/team/worker:latest', [
			'registry:5000/team/worker@sha256:deef',
		]);
		expect(digest).toBe('registry:5000/team/worker@sha256:deef');
	});
});

describe('handleWorkerImageValidation', () => {
	beforeEach(() => {
		mockLogger.info.mockClear();
		mockLogger.warn.mockClear();
		mockLogger.error.mockClear();
	});

	it('resolves the digest and marks verified on a passing image', async () => {
		const deps = makeDeps();

		await handleWorkerImageValidation(PAYLOAD, deps);

		expect(deps.pullImage).toHaveBeenCalledWith(PAYLOAD.ref);
		expect(deps.recordResult).toHaveBeenCalledWith('proj-1', PAYLOAD.ref, {
			status: 'verified',
			digest: 'ghcr.io/acme/cascade-worker@sha256:abc123',
			error: null,
		});
	});

	it('marks failed with a precise reason naming the missing binary on a smoke-test failure', async () => {
		const deps = makeDeps({
			runImageCheck: vi.fn().mockResolvedValue({
				exitCode: 1,
				output: 'FAIL: cascade-tools check failed (cascade-tools --version)',
			}),
		});

		await handleWorkerImageValidation(PAYLOAD, deps);

		expect(deps.recordResult).toHaveBeenCalledTimes(1);
		const [projectId, ref, result] = (deps.recordResult as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(projectId).toBe('proj-1');
		expect(ref).toBe(PAYLOAD.ref);
		expect(result.status).toBe('failed');
		expect(result.digest).toBeNull();
		expect(result.error).toContain('cascade-tools');
	});

	it('marks failed when the image is unpullable', async () => {
		const deps = makeDeps({
			pullImage: vi.fn().mockRejectedValue(new Error('manifest unknown: not found')),
		});

		await handleWorkerImageValidation(PAYLOAD, deps);

		const calls = (deps.recordResult as ReturnType<typeof vi.fn>).mock.calls;
		expect(calls).toHaveLength(1);
		expect(calls[0][2].status).toBe('failed');
		expect(calls[0][2].error).toContain('manifest unknown');
		// Smoke-test is never reached when the pull fails.
		expect(deps.runImageCheck).not.toHaveBeenCalled();
	});

	it('marks failed when no immutable digest can be resolved', async () => {
		const deps = makeDeps({ inspectImageDigest: vi.fn().mockResolvedValue(null) });

		await handleWorkerImageValidation(PAYLOAD, deps);

		const calls = (deps.recordResult as ReturnType<typeof vi.fn>).mock.calls;
		expect(calls[0][2].status).toBe('failed');
		expect(calls[0][2].error).toContain('digest');
		expect(deps.runImageCheck).not.toHaveBeenCalled();
	});

	it('is idempotent — a re-run on the same passing ref converges to verified', async () => {
		const deps = makeDeps();

		await handleWorkerImageValidation(PAYLOAD, deps);
		await handleWorkerImageValidation(PAYLOAD, deps);

		const calls = (deps.recordResult as ReturnType<typeof vi.fn>).mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[0][2].status).toBe('verified');
		expect(calls[1][2].status).toBe('verified');
	});

	it('drops a stale result without error when the ref changed (recordResult returns false)', async () => {
		const deps = makeDeps({ recordResult: vi.fn().mockResolvedValue(false) });

		await handleWorkerImageValidation(PAYLOAD, deps);

		expect(deps.recordResult).toHaveBeenCalledWith(
			'proj-1',
			PAYLOAD.ref,
			expect.objectContaining({ status: 'verified' }),
		);
		// No crash, no failed-write — the newer ref owns its own validation.
		expect(mockLogger.info).toHaveBeenCalledWith(
			'[worker-image-validation] skipped stale result (ref changed)',
			expect.any(Object),
		);
	});

	it('never throws and records failed when an unexpected error occurs', async () => {
		const deps = makeDeps({
			inspectImageDigest: vi.fn().mockRejectedValue(new Error('docker daemon gone')),
		});

		await expect(handleWorkerImageValidation(PAYLOAD, deps)).resolves.toBeUndefined();

		const calls = (deps.recordResult as ReturnType<typeof vi.fn>).mock.calls;
		expect(calls[0][2].status).toBe('failed');
		expect(calls[0][2].error).toContain('docker daemon gone');
		expect(deps.captureException).toHaveBeenCalled();
	});
});

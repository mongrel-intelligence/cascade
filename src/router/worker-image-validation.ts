/**
 * Router-side per-project worker-image validation (spec 022 plan 3/4).
 *
 * The dashboard/API process cannot touch Docker (the socket is router-only), so
 * the set-image mutation records the reference as `pending` and enqueues a
 * `worker-image-validation` job. This handler runs where the router consumes the
 * dashboard-jobs queue — it has the Docker socket — and:
 *
 *   1. Pulls the operator-set reference (host-pullable / public / local in v1).
 *   2. Inspects it to pin the immutable `@sha256:` digest (from `RepoDigests`).
 *   3. Runs the cascade-compatible-worker-image runtime smoke-test inside a
 *      one-shot `docker run --rm` (the same checks the CI smoke-test asserts).
 *   4. Marks the project `verified` (digest pinned) or `failed` (precise reason).
 *
 * Fail-closed invariant (AC #4): the project is NEVER left stuck in `pending`.
 * Any failure — unpullable image, missing digest, smoke-test failure, or an
 * unexpected handler error — flips it to `failed` with a precise reason. Plan 2's
 * spawn resolver only launches a `verified` digest, so a `failed`/`pending`
 * project can never launch a bad image.
 */

import { Writable } from 'node:stream';
import Docker from 'dockerode';
import { recordWorkerImageValidationResult } from '../db/repositories/projectsRepository.js';
import { captureException as captureExceptionDefault } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { routerConfig } from './config.js';
import { buildWorkerImageCheckScript } from './worker-image-checks.js';
import { pullImageOnce } from './worker-snapshots.js';

const docker = new Docker();

/** Wall-clock budget for the one-shot smoke-test container. */
const SMOKE_TEST_TIMEOUT_MS = 5 * 60 * 1000;

export interface WorkerImageValidationPayload {
	projectId: string;
	ref: string;
}

export interface WorkerImageValidationDeps {
	/** Pull the candidate image (throws when unpullable). */
	pullImage: (ref: string) => Promise<void>;
	/** Resolve the immutable `repo@sha256:...` launch digest, or null if absent. */
	inspectImageDigest: (ref: string) => Promise<string | null>;
	/** Run the runtime smoke-test inside the image; returns exit code + combined output. */
	runImageCheck: (ref: string) => Promise<{ exitCode: number; output: string }>;
	/** Persist the verified/failed result (ref-guarded). Returns whether a row was written. */
	recordResult: typeof recordWorkerImageValidationResult;
	captureException: typeof captureExceptionDefault;
}

/**
 * Choose the `repo@sha256:...` RepoDigests entry whose repository matches the
 * pulled reference, falling back to the first entry. The result is a fully
 * qualified, pull-by-digest reference — exactly what plan 2's spawn resolver
 * launches (`projectCfg.workerImageDigest`), so it must NOT be reduced to a bare
 * `sha256:...` value.
 */
export function resolveDigestFromRepoDigests(ref: string, repoDigests: string[]): string | null {
	if (repoDigests.length === 0) return null;
	const refRepo = repositoryOf(ref);
	const match = repoDigests.find((rd) => repositoryOf(rd) === refRepo);
	return match ?? repoDigests[0];
}

/** Strip a `@digest` suffix and a trailing `:tag` to get the repository name. */
function repositoryOf(reference: string): string {
	const noDigest = reference.split('@')[0];
	const lastSlash = noDigest.lastIndexOf('/');
	const lastColon = noDigest.lastIndexOf(':');
	// A colon AFTER the last slash is a tag separator; a colon before it is a
	// registry port (e.g. `registry:5000/repo`) and must be kept.
	return lastColon > lastSlash ? noDigest.slice(0, lastColon) : noDigest;
}

async function defaultInspectImageDigest(ref: string): Promise<string | null> {
	const image = docker.getImage(ref);
	const info = (await image.inspect()) as { RepoDigests?: string[] };
	return resolveDigestFromRepoDigests(ref, info.RepoDigests ?? []);
}

async function defaultRunImageCheck(ref: string): Promise<{ exitCode: number; output: string }> {
	const script = buildWorkerImageCheckScript();
	const chunks: Buffer[] = [];
	const sink = new Writable({
		write(chunk, _enc, cb) {
			chunks.push(Buffer.from(chunk));
			cb();
		},
	});

	// Tty:true gives a single combined stdout+stderr stream (no multiplexing
	// header to demux), which is all we need to surface the failing check line.
	const runPromise = docker.run(ref, ['bash', '-lc', script], sink, {
		Tty: true,
		HostConfig: {
			AutoRemove: true,
			NetworkMode: routerConfig.dockerNetwork,
			Memory: routerConfig.workerMemoryMb * 1024 * 1024,
			MemorySwap: routerConfig.workerMemoryMb * 1024 * 1024,
		},
	}) as Promise<[{ StatusCode: number }, unknown]>;

	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(
			() => reject(new Error(`worker-image smoke-test timed out after ${SMOKE_TEST_TIMEOUT_MS}ms`)),
			SMOKE_TEST_TIMEOUT_MS,
		);
	});

	try {
		const [result] = await Promise.race([runPromise, timeout]);
		return { exitCode: result.StatusCode, output: Buffer.concat(chunks).toString('utf-8') };
	} finally {
		if (timer) clearTimeout(timer);
	}
}

const defaultDeps: WorkerImageValidationDeps = {
	pullImage: (ref) => pullImageOnce(ref),
	inspectImageDigest: defaultInspectImageDigest,
	runImageCheck: defaultRunImageCheck,
	recordResult: recordWorkerImageValidationResult,
	captureException: captureExceptionDefault,
};

/** Trim and cap a smoke-test output so the stored failure reason stays readable. */
function summarizeFailure(prefix: string, output: string): string {
	const failLine = output
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.reverse()
		.find((l) => l.startsWith('FAIL:'));
	const detail = failLine ?? output.trim().slice(-500);
	return detail ? `${prefix}: ${detail}` : prefix;
}

async function persistFailed(
	deps: WorkerImageValidationDeps,
	projectId: string,
	ref: string,
	error: string,
): Promise<void> {
	const wrote = await deps.recordResult(projectId, ref, { status: 'failed', digest: null, error });
	logger.warn('[worker-image-validation] failed', { projectId, ref, error, wrote });
}

/**
 * Validate a project's worker image and persist the verified/failed outcome.
 *
 * Never throws on a validation failure — every path that does not reach
 * `verified` records `failed` instead, so the project cannot be stranded in
 * `pending`.
 */
export async function handleWorkerImageValidation(
	payload: WorkerImageValidationPayload,
	deps: WorkerImageValidationDeps = defaultDeps,
): Promise<void> {
	const { projectId, ref } = payload;
	logger.info('[worker-image-validation] starting', { projectId, ref });

	try {
		await deps.pullImage(ref);

		const digest = await deps.inspectImageDigest(ref);
		if (!digest) {
			await persistFailed(
				deps,
				projectId,
				ref,
				`Could not resolve an immutable digest for ${ref} (no RepoDigests after pull)`,
			);
			return;
		}

		const { exitCode, output } = await deps.runImageCheck(ref);
		if (exitCode !== 0) {
			await persistFailed(
				deps,
				projectId,
				ref,
				summarizeFailure(`Runtime smoke-test failed (exit ${exitCode})`, output),
			);
			return;
		}

		const wrote = await deps.recordResult(projectId, ref, {
			status: 'verified',
			digest,
			error: null,
		});
		if (wrote) {
			logger.info('[worker-image-validation] verified', { projectId, ref, digest });
		} else {
			// The operator changed/cleared the ref while validation ran; the newer
			// reference owns its own job. Dropping this result is correct.
			logger.info('[worker-image-validation] skipped stale result (ref changed)', {
				projectId,
				ref,
				digest,
			});
		}
	} catch (err) {
		// Fail-closed: an unpullable image, an inspect failure, or any unexpected
		// error must mark the project `failed` — never leave it stuck in `pending`.
		const message = err instanceof Error ? err.message : String(err);
		deps.captureException(err, {
			tags: { source: 'worker_image_validation' },
			extra: { projectId, ref },
		});
		await persistFailed(deps, projectId, ref, `Validation error: ${message}`).catch(
			(persistErr) => {
				logger.error('[worker-image-validation] failed to persist failure', {
					projectId,
					ref,
					error: String(persistErr),
				});
				deps.captureException(persistErr, {
					tags: { source: 'worker_image_validation_persist' },
					extra: { projectId, ref },
				});
			},
		);
	}
}

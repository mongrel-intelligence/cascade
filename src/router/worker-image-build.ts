/**
 * Router-side per-project worker-image BUILD engine (spec 023 plan 3/5).
 *
 * The first-ever `docker build` in the tree. It is a strict superset of the
 * reference-image validation handler (`worker-image-validation.ts`): where that
 * handler PULLS an operator-supplied image and pins its registry digest, this
 * one COMPOSES the operator's extra layers onto the pinned base, BUILDS a local
 * image, pins its immutable LOCAL image ID, runs the same runtime smoke-test, and
 * records `verified`/`failed` — all fail-closed.
 *
 * It rides the same dashboard-jobs seam as validation: dispatched directly by
 * `processDashboardJob` (no worker slot, no container spawn), with a
 * deterministic per-project jobId so a re-enqueue supersedes an in-flight build.
 *
 * The engine contract, in order (see the ticket / spec 023 plan 3):
 *
 *   1. Guard      — drop if the DB's `worker_image_build_hash` no longer equals
 *                   the job's hash (a newer set superseded this build).
 *   2. Base digest — resolve the global `routerConfig.workerImage` to an
 *                   immutable `repo@sha256:...` (the base the composed FROM pins).
 *   3. Compose    — wrap the operator content (throws on a self-declared FROM).
 *   4. Reuse      — if a local `cascade-built-<projectId>:latest` image already
 *                   carries a `cascade.build_hash` label equal to the full-hash
 *                   and is intact, reuse it (no `docker build`).
 *   5. Build      — `docker.buildImage()` from an in-memory tar, tagged
 *                   `cascade-built-<projectId>:latest`, bounded by
 *                   `workerBuildTimeoutMs`.
 *   6. Pin        — inspect the built image → immutable LOCAL image ID.
 *   7. Smoke-test — run the shared runtime check inside the built image.
 *   8. Record     — write the active pin + statuses, guarded on the build hash.
 *
 * **Fail-closed (AC #2/#4).** Every non-verified path — a self-declared FROM, a
 * build failure, a build timeout, a smoke-test non-zero exit, or any unexpected
 * throw — routes through `recordResult({ status: 'failed', ... })` with a precise
 * reason and NEVER leaves the project stuck in `building`. Build failures start
 * `build failed:`; smoke-test failures start a DISTINCT `runtime requirement
 * missing:` (AC #2). An unexpected throw is additionally Sentry-captured under
 * tag `worker_image_build`. The handler never rejects, so BullMQ always sees the
 * job complete.
 *
 * **No-strand (AC #6).** A rebuild that fails while a last-good `verified` image
 * exists keeps `worker_image_status = verified` on the old pin (the project keeps
 * running) and records only `worker_image_build_status = failed` + reason. A
 * FIRST build failure (no prior verified image) sets `worker_image_status =
 * failed`. Both decisions are driven by the `keepActive` flag computed from the
 * pre-build DB snapshot.
 *
 * **No secrets (AC #7).** The build carries no build-args and no project
 * credentials; the credential master key is never in scope here. Builds are
 * public-only by design.
 */

import { Readable } from 'node:stream';
import Docker from 'dockerode';
import {
	readWorkerImageBuildInputs,
	recordWorkerImageBuildResult,
} from '../db/repositories/projectsRepository.js';
import { captureException as captureExceptionDefault } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { routerConfig } from './config.js';
import {
	CASCADE_BUILD_HASH_LABEL_KEY,
	composeDockerfile,
	computeFullBuildHash,
} from './worker-dockerfile-compose.js';
import {
	resolveDigestFromRepoDigests,
	runWorkerImageSmokeTest,
} from './worker-image-validation.js';
import { isImageNotFoundError, pullImageOnce } from './worker-snapshots.js';

const docker = new Docker();

export interface WorkerImageBuildPayload {
	projectId: string;
	/** The content-hash of the desired Dockerfile content (job identity + guard). */
	buildHash: string;
}

/** A built image's identity as seen by an inspect: local image ID + full-hash label. */
export interface BuiltImageInfo {
	/** Immutable LOCAL image ID (`sha256:...`) — the launchable pin ticket 2 consumes. */
	id: string;
	/** The `cascade.build_hash` label value, or null when absent. */
	fullHash: string | null;
}

export interface WorkerImageBuildDeps {
	/** Read the pre-build DB snapshot (dockerfile content, build hash, last-good pin). */
	readInputs: typeof readWorkerImageBuildInputs;
	/** Resolve the global base image to an immutable `repo@sha256:...` reference. */
	resolveBaseDigest: () => Promise<string>;
	/** Build the composed Dockerfile into `tag`, stamping the full-hash label. */
	buildImage: (opts: { dockerfile: string; tag: string; fullHash: string }) => Promise<void>;
	/** Inspect `tag` → its LOCAL image ID + full-hash label, or null when absent. */
	inspectBuiltImage: (tag: string) => Promise<BuiltImageInfo | null>;
	/** Run the runtime smoke-test inside the built image; returns exit code + output. */
	runImageCheck: (ref: string) => Promise<{ exitCode: number; output: string }>;
	/** Persist the verified/failed result (build-hash-guarded). Returns whether a row was written. */
	recordResult: typeof recordWorkerImageBuildResult;
	captureException: typeof captureExceptionDefault;
	/** Wall-clock budget for the build step. */
	workerBuildTimeoutMs: number;
}

/**
 * Build the stable per-project tag for a dockerfile-built image.
 *
 * A single `:latest` tag per project: a successful rebuild retags it to the new
 * image, so the superseded digest becomes dangling and is reclaimed by the
 * existing 30-min `dangling-image-cleanup` loop — no new GC loop. The active
 * tagged image is never dangling, so a GC sweep can never remove the last-good
 * image. Sanitisation mirrors `buildWorkerSnapshotImageName` so any projectId is
 * a valid Docker tag.
 */
export function builtImageTag(projectId: string): string {
	const sanitised = projectId
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
	return `cascade-built-${sanitised}:latest`;
}

/**
 * Build an in-memory POSIX ustar tar containing exactly one file. Used to feed
 * `docker.buildImage()` a build context with just the composed Dockerfile — no
 * files on disk, no project sources, no secrets.
 */
export function createSingleFileTar(name: string, content: string): Buffer {
	const body = Buffer.from(content, 'utf-8');
	const header = Buffer.alloc(512, 0);

	header.write(name, 0, 100, 'utf-8'); // name
	header.write('0000644\0', 100, 8, 'utf-8'); // mode
	header.write('0000000\0', 108, 8, 'utf-8'); // uid
	header.write('0000000\0', 116, 8, 'utf-8'); // gid
	header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf-8'); // size
	header.write(
		`${Math.floor(Date.now() / 1000)
			.toString(8)
			.padStart(11, '0')}\0`,
		136,
		12,
		'utf-8',
	); // mtime
	header.write('        ', 148, 8, 'utf-8'); // chksum placeholder (8 spaces)
	header.write('0', 156, 1, 'utf-8'); // typeflag: regular file
	header.write('ustar\0', 257, 6, 'utf-8'); // magic
	header.write('00', 263, 2, 'utf-8'); // version

	// Header checksum: sum of every header byte with the chksum field as spaces,
	// stored as 6 octal digits + NUL + space.
	let sum = 0;
	for (let i = 0; i < 512; i++) sum += header[i];
	header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf-8');

	// File body padded up to a 512-byte block boundary.
	const pad = body.length % 512 === 0 ? 0 : 512 - (body.length % 512);
	const paddedBody = pad === 0 ? body : Buffer.concat([body, Buffer.alloc(pad, 0)]);

	// Two zero blocks terminate the archive.
	const trailer = Buffer.alloc(1024, 0);
	return Buffer.concat([header, paddedBody, trailer]);
}

/** The minimal `docker image inspect` shape needed to pin an immutable base ref. */
export interface LocalImageInspect {
	/** The immutable LOCAL image ID (`sha256:...`). */
	Id?: string;
	/** Registry digests (`repo@sha256:...`) — present only for registry-provenance images. */
	RepoDigests?: string[];
}

/** Injectable Docker glue for {@link resolveBaseImageRef} (keeps the decision logic unit-testable). */
export interface ResolveBaseImageRefDeps {
	/** Best-effort registry pull for the freshest digest. May throw (401/auth, network, ENOTFOUND). */
	pull: () => Promise<void>;
	/** Inspect the local image; throws (image-not-found) when the base is genuinely absent. */
	inspectLocal: () => Promise<LocalImageInspect>;
}

/**
 * Resolve the immutable base reference to pin the composed `FROM` on — tolerating a
 * registry-pull failure when the base image is already present on the host
 * (dev-incident 2026-07-03, MNG-1731).
 *
 * The router's Docker daemon does not always carry STANDING registry credentials
 * for on-demand pulls, yet the global base image is already present locally (the
 * router runs every worker from it; it was pulled at deploy time and carries local
 * `RepoDigests`). The immutable digest is obtainable from the local inspect without
 * any registry call, so an unconditional pull must not be what blocks a build. This
 * also unblocks self-hosted deployments whose base is present locally but not
 * freshly pullable.
 *
 * Order:
 *   1. Best-effort `pull()` for the freshest digest. A pull failure (401/auth,
 *      network, ENOTFOUND) is tolerated when the base image is already local.
 *   2. `inspectLocal()`. If the image is genuinely absent AND the pull failed,
 *      throw a clear, greppable "cannot obtain base image" error (fail-closed — no
 *      silent fallback to a wrong/moving image).
 *   3. Primary path (unchanged): the immutable registry digest from `RepoDigests`.
 *   4. Self-hosted / locally-built base with no `RepoDigests`: pin by the local
 *      image ID (`inspect().Id`). The composed build uses `pull: false`, so a local
 *      reference resolves without a registry call. Never fall back to the moving
 *      tag — the pin must stay immutable.
 */
export async function resolveBaseImageRef(
	ref: string,
	deps: ResolveBaseImageRefDeps,
): Promise<string> {
	// 1. Best-effort registry pull for the freshest digest.
	let pullError: unknown;
	try {
		await deps.pull();
	} catch (err) {
		pullError = err;
	}

	// 2. Inspect the (just-pulled or pre-existing) local image.
	let info: LocalImageInspect;
	try {
		info = await deps.inspectLocal();
	} catch (inspectErr) {
		if (pullError !== undefined) {
			// Neither pullable nor present locally → cannot obtain the base image.
			throw new Error(
				`cannot obtain base image ${ref}: registry pull failed (${errMessage(pullError)}) ` +
					`and it is not present locally (${errMessage(inspectErr)})`,
			);
		}
		// Pull reported success but the image is not inspectable — surface it as-is.
		throw inspectErr;
	}

	if (pullError !== undefined) {
		logger.warn(
			'[worker-image-build] base-image registry pull failed; resolving from the local base image',
			{ ref, error: errMessage(pullError) },
		);
	}

	// 3. Primary path: the immutable registry digest (registry provenance). Byte-for-byte
	//    identical to the previous behavior when the pull succeeds and RepoDigests exist.
	const digest = resolveDigestFromRepoDigests(ref, info.RepoDigests ?? []);
	if (digest) return digest;

	// 4. Self-hosted / locally-built base (no RepoDigests): pin by the immutable
	//    local image ID rather than failing.
	if (info.Id) return info.Id;

	throw new Error(
		`cannot obtain base image ${ref}: the local image has neither RepoDigests nor an image ID to pin`,
	);
}

// ── Un-mockable Docker-daemon glue (excluded from coverage) ─────────────────
// The `defaultDeps` implementations below only execute against a live Docker
// daemon (docker.buildImage / image inspect / pull), so unit tests drive the
// handler through injected fakes instead. The runtime contract is covered by the
// shared worker-image smoke-test (tests/docker/worker-runtime-tools). These
// default-impl blocks carry line-level v8-ignore markers so they cannot
// recurrently fail codecov/patch on future image/build PRs — see the
// "Un-mockable Docker-daemon glue policy" note in codecov.yml. This is
// deliberately narrow: handler logic + createSingleFileTar stay counted.
/* v8 ignore start */
/**
 * Default `resolveBaseDigest`: wire the real Docker `pull`/`inspect` into the
 * injectable {@link resolveBaseImageRef} decision helper. The pull is best-effort —
 * when the router daemon has no standing registry auth (dev/self-hosted) but the
 * base image is already present locally, the immutable ref is resolved from the
 * local inspect without a registry call. The composed FROM pins to the returned
 * ref, and it is folded into the full-hash so a base bump forces a rebuild.
 */
async function defaultResolveBaseDigest(): Promise<string> {
	const ref = routerConfig.workerImage;
	return resolveBaseImageRef(ref, {
		pull: () => pullImageOnce(ref),
		inspectLocal: async () => (await docker.getImage(ref).inspect()) as LocalImageInspect,
	});
}

/**
 * Default `buildImage`: stream a one-file tar (the composed Dockerfile) to the
 * Docker build endpoint, tagged and stamped with the full-hash label. Rejects on
 * a stream error OR a build-step error surfaced in the progress body (moby
 * reports build failures as a message object, not a stream error). No build-args
 * and no auth — public-only builds.
 */
async function defaultBuildImage(opts: {
	dockerfile: string;
	tag: string;
	fullHash: string;
}): Promise<void> {
	const tar = createSingleFileTar('Dockerfile', opts.dockerfile);
	const buildStream = (await docker.buildImage(Readable.from(tar), {
		t: opts.tag,
		labels: { [CASCADE_BUILD_HASH_LABEL_KEY]: opts.fullHash },
		forcerm: true,
		// The base was just resolved+pulled and the composed FROM pins its
		// immutable digest, so there is nothing to pull during the build.
		pull: false,
	})) as NodeJS.ReadableStream;

	await new Promise<void>((resolve, reject) => {
		docker.modem.followProgress(
			buildStream,
			(
				err: Error | null,
				output: Array<{ error?: string; errorDetail?: { message?: string } }>,
			) => {
				if (err) {
					reject(err);
					return;
				}
				const failure = output?.find((o) => o?.error || o?.errorDetail?.message);
				if (failure) {
					reject(
						new Error(
							failure.errorDetail?.message ?? failure.error ?? 'docker build reported an error',
						),
					);
					return;
				}
				resolve();
			},
		);
	});
}

/** Default `inspectBuiltImage`: local image ID + `cascade.build_hash` label, or null when absent. */
async function defaultInspectBuiltImage(tag: string): Promise<BuiltImageInfo | null> {
	try {
		const info = (await docker.getImage(tag).inspect()) as {
			Id?: string;
			Config?: { Labels?: Record<string, string> | null };
		};
		if (!info?.Id) return null;
		return { id: info.Id, fullHash: info.Config?.Labels?.[CASCADE_BUILD_HASH_LABEL_KEY] ?? null };
	} catch (err) {
		if (isImageNotFoundError(err)) return null;
		throw err;
	}
}
/* v8 ignore stop */

const defaultDeps: WorkerImageBuildDeps = {
	readInputs: readWorkerImageBuildInputs,
	resolveBaseDigest: defaultResolveBaseDigest,
	buildImage: defaultBuildImage,
	inspectBuiltImage: defaultInspectBuiltImage,
	runImageCheck: runWorkerImageSmokeTest,
	recordResult: recordWorkerImageBuildResult,
	captureException: captureExceptionDefault,
	workerBuildTimeoutMs: routerConfig.workerBuildTimeoutMs,
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

/**
 * Race a build against a wall-clock timeout. On timeout the underlying build
 * promise is abandoned (dockerode has no cancel hook, same as the validation
 * smoke-test timeout) and the caller records `failed`.
 */
async function withBuildTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`build timed out after ${timeoutMs}ms`)), timeoutMs);
	});
	try {
		await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function persistFailed(
	deps: WorkerImageBuildDeps,
	projectId: string,
	buildHash: string,
	error: string,
	keepActive: boolean,
): Promise<void> {
	const wrote = await deps.recordResult(projectId, buildHash, {
		status: 'failed',
		error,
		keepActive,
	});
	logger.warn('[worker-image-build] failed', { projectId, buildHash, error, keepActive, wrote });
}

function errMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** A step that either yields a value or a precise failure reason to persist. */
type StepResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Resolve the launchable pin (steps 4–6): reuse an intact local image whose
 * `cascade.build_hash` label matches the full-hash, otherwise build the composed
 * Dockerfile (bounded by the wall-clock budget) and inspect it for its immutable
 * local image ID. Build/pin failures return a `build failed:` reason; the caller
 * persists it. Extracted from the handler to keep each unit's branching small.
 */
async function resolvePin(
	deps: WorkerImageBuildDeps,
	opts: { composed: string; fullHash: string; tag: string },
): Promise<StepResult<string>> {
	// 4. Content-hash reuse — skip `docker build` when an intact local image
	//    already carries the matching full-hash label.
	const existing = await deps.inspectBuiltImage(opts.tag);
	if (existing?.id && existing.fullHash === opts.fullHash) {
		logger.info('[worker-image-build] reusing intact image (full-hash match), skipping build', {
			tag: opts.tag,
			pin: existing.id,
		});
		return { ok: true, value: existing.id };
	}

	// 5. Build, bounded by the wall-clock budget.
	try {
		await withBuildTimeout(
			deps.buildImage({ dockerfile: opts.composed, tag: opts.tag, fullHash: opts.fullHash }),
			deps.workerBuildTimeoutMs,
		);
	} catch (buildErr) {
		return { ok: false, reason: `build failed: ${errMessage(buildErr)}` };
	}

	// 6. Pin — inspect the freshly built image for its immutable local ID.
	const built = await deps.inspectBuiltImage(opts.tag);
	if (!built?.id) {
		return {
			ok: false,
			reason: 'build failed: could not inspect the built image to pin its local image ID',
		};
	}
	return { ok: true, value: built.id };
}

/**
 * Build a project's worker image from its Dockerfile content and persist the
 * verified/failed outcome. Never throws — every non-verified path records
 * `failed`, so the project cannot be stranded in `building`.
 */
export async function handleWorkerImageBuild(
	payload: WorkerImageBuildPayload,
	deps: WorkerImageBuildDeps = defaultDeps,
): Promise<void> {
	const { projectId, buildHash } = payload;
	logger.info('[worker-image-build] starting', { projectId, buildHash });

	// Whether a last-good verified pin exists — governs the no-strand rule on
	// every failed path. Resolved from the pre-build snapshot below; false until
	// then so an early failure without a prior verified image marks `failed`.
	let keepActive = false;

	try {
		// 1. Guard — read the pre-build snapshot and drop if superseded.
		const inputs = await deps.readInputs(projectId);
		if (!inputs) {
			logger.warn('[worker-image-build] project not found, dropping', { projectId, buildHash });
			return;
		}
		keepActive = inputs.workerImageStatus === 'verified' && !!inputs.workerImageDigest;

		if (inputs.buildHash !== buildHash) {
			// A newer set changed the desired content; that job owns its own build.
			logger.info('[worker-image-build] superseded — build hash changed, dropping', {
				projectId,
				jobBuildHash: buildHash,
				currentBuildHash: inputs.buildHash,
			});
			return;
		}

		const content = inputs.dockerfile;
		if (content == null || content.trim() === '') {
			await persistFailed(
				deps,
				projectId,
				buildHash,
				'build failed: no worker Dockerfile content to build',
				keepActive,
			);
			return;
		}

		// 2. Resolve the immutable base digest.
		const baseDigest = await deps.resolveBaseDigest();

		// 3. Compose (throws on a self-declared FROM).
		let composed: string;
		try {
			composed = composeDockerfile(content, baseDigest);
		} catch (composeErr) {
			await persistFailed(
				deps,
				projectId,
				buildHash,
				`build failed: ${errMessage(composeErr)}`,
				keepActive,
			);
			return;
		}

		// 4–6. Reuse an intact image or build + pin the local image ID.
		const fullHash = computeFullBuildHash(composed, baseDigest);
		const tag = builtImageTag(projectId);
		const pinned = await resolvePin(deps, { composed, fullHash, tag });
		if (!pinned.ok) {
			await persistFailed(deps, projectId, buildHash, pinned.reason, keepActive);
			return;
		}

		// 7. Smoke-test — the SAME runtime contract the reference-image validator
		//    asserts, run against the immutable pin (not the retag-able tag).
		const { exitCode, output } = await deps.runImageCheck(pinned.value);
		if (exitCode !== 0) {
			await persistFailed(
				deps,
				projectId,
				buildHash,
				summarizeFailure(`runtime requirement missing (exit ${exitCode})`, output),
				keepActive,
			);
			return;
		}

		// 8. Record verified, guarded on the build hash. A false result means the
		//    operator changed the desired content while the build ran; the newer
		//    content owns its own build job, so dropping this result is correct.
		const wrote = await deps.recordResult(projectId, buildHash, {
			status: 'verified',
			digest: pinned.value,
			error: null,
		});
		logger.info(
			wrote
				? '[worker-image-build] verified'
				: '[worker-image-build] skipped stale result (build hash changed)',
			{ projectId, buildHash, pin: pinned.value },
		);
	} catch (err) {
		// Fail-closed: any unexpected error marks the project `failed` — never
		// leave it stuck in `building`.
		deps.captureException(err, {
			tags: { source: 'worker_image_build' },
			extra: { projectId, buildHash },
		});
		await persistFailed(
			deps,
			projectId,
			buildHash,
			`build error: ${errMessage(err)}`,
			keepActive,
		).catch((persistErr) => {
			logger.error('[worker-image-build] failed to persist failure', {
				projectId,
				buildHash,
				error: String(persistErr),
			});
			deps.captureException(persistErr, {
				tags: { source: 'worker_image_build_persist' },
				extra: { projectId, buildHash },
			});
		});
	}
}

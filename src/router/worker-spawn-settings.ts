/**
 * Worker spawn settings for CASCADE worker containers.
 *
 * Resolves Docker-free configuration decisions used by container-manager.ts:
 * effective worker image, snapshot reuse, router timeout, and safe container
 * names. This module intentionally has no Docker dependency.
 */

import type { WorkerImageSource } from '../config/schema.js';
import type { ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { loadProjectConfig, routerConfig } from './config.js';
import { getSnapshot } from './snapshot-manager.js';

/** Buffer added on top of the in-container watchdog so the router kill is always a backstop. */
export const ROUTER_KILL_BUFFER_MS = 2 * 60 * 1000;

export interface SpawnSettings {
	snapshotEnabled: boolean;
	/**
	 * The image the container is actually launched from. Equals
	 * `effectiveBaseImage` for a fresh run, or a per-(project,workItem) snapshot
	 * image when a snapshot is reused.
	 */
	workerImage: string;
	/**
	 * The base image for this project — the project's verified per-project worker
	 * image digest when configured (spec 022), otherwise the global
	 * `routerConfig.workerImage`. Load-bearing: container-manager.ts compares the
	 * launch image against THIS (not the global default) to classify pull-fallback,
	 * snapshot reuse, and snapshot-404 fallback. Snapshot substitution is layered
	 * ON TOP of this value.
	 */
	effectiveBaseImage: string;
	/**
	 * True ONLY when `effectiveBaseImage` is a **dockerfile-built** image (spec
	 * 023) — an immutable LOCAL image ID that exists solely on the router daemon
	 * that built it. A registry pull can NEVER satisfy such an image, so
	 * container-manager.ts must fail-closed (terminal reachability error) instead
	 * of pulling when a local-only base is missing. `false` for `default` and
	 * `reference` sources (both registry-backed and safe to pull-on-missing).
	 */
	effectiveBaseImageLocalOnly: boolean;
	/**
	 * The derived image source that governed this resolution (spec 023):
	 * `dockerfile` > `reference` > `default`. Surfaced so the spawn log records
	 * which image kind governed a run and so downstream launch code never has to
	 * re-derive it.
	 */
	workerImageSource: WorkerImageSource;
	containerTimeoutMs: number;
	snapshotTtlMs: number;
}

/**
 * Terminal error for an unresolvable per-project worker image (spec 022).
 *
 * Thrown when a project configures a `workerImage` that is not yet verified
 * (no pinned digest) or whose digest cannot be obtained at spawn time. The
 * dispatch-error classifier treats this as `terminal` (by `name`) so BullMQ
 * skips the retry budget — a misconfigured/unobtainable image will never
 * resolve on retry, and we must NEVER silently fall back to the global image.
 */
export class WorkerImageResolutionError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message);
		this.name = 'WorkerImageResolutionError';
		if (options?.cause !== undefined) {
			(this as { cause?: unknown }).cause = options.cause;
		}
	}
}

/**
 * Build the Docker container name for a worker job.
 *
 * Docker container names accept only `[a-zA-Z0-9][a-zA-Z0-9_.-]`. BullMQ
 * coalesced jobs can include colons (`coalesce:project:item`), so disallowed
 * chars are replaced with underscores while the original jobId remains intact
 * for logs and dedup keys.
 */
export function buildWorkerContainerName(jobId: string): string {
	const containerSafeJobId = jobId.replace(/[^a-zA-Z0-9_.-]/g, '_');
	return `cascade-worker-${containerSafeJobId}`;
}

/**
 * Resolve the effective base image for a project (spec 022, extended for the
 * dockerfile source in spec 023).
 *
 * Returns the resolved base image plus `localOnly` (true only for a
 * `dockerfile`-built image). Resolution is keyed on the derived
 * `workerImageSource`:
 *
 * - **`dockerfile`** (spec 023): launch by the immutable LOCAL image ID held in
 *   `workerImageDigest`. Requires `workerImageStatus === 'verified'` AND a
 *   non-empty pin (a `pending`/`building`/`failed`/empty-pin source throws
 *   terminal — never a silent global fallback). Marked `localOnly: true` because
 *   the built image lives only on the router daemon that built it and can never
 *   be satisfied by a registry pull.
 * - **`reference`** (spec 022) / **`default`**: byte-for-byte the original
 *   spec-022 behavior — a configured `workerImage` must be `verified` with a
 *   non-empty pinned digest, otherwise throw terminal; no `workerImage` falls
 *   back to the global default. Both are registry-backed → `localOnly: false`.
 *
 * We NEVER silently fall back to the global default for a project that explicitly
 * configured its own image (reference) or Dockerfile.
 */
function resolveEffectiveBaseImage(
	projectId: string,
	projectCfg: ProjectConfig | undefined,
): { image: string; localOnly: boolean } {
	const source: WorkerImageSource = projectCfg?.workerImageSource ?? 'default';

	// Dockerfile-built image (spec 023): launch by the immutable LOCAL image ID.
	// Fail-closed on any non-verified/empty-pin state; the built image is
	// local-only so it must never be resolved to (or pulled as) a registry image.
	if (source === 'dockerfile') {
		if (projectCfg?.workerImageStatus !== 'verified' || !projectCfg.workerImageDigest) {
			throw new WorkerImageResolutionError(
				`Project worker image not verified: ${projectId} status=${projectCfg?.workerImageStatus ?? 'unset'} source=dockerfile`,
			);
		}
		return { image: projectCfg.workerImageDigest, localOnly: true };
	}

	// default / reference — byte-for-byte unchanged from spec 022.
	if (!projectCfg?.workerImage) return { image: routerConfig.workerImage, localOnly: false };
	if (projectCfg.workerImageStatus !== 'verified' || !projectCfg.workerImageDigest) {
		throw new WorkerImageResolutionError(
			`Project worker image not verified: ${projectId} status=${projectCfg.workerImageStatus ?? 'unset'} image=${projectCfg.workerImage}`,
		);
	}
	return { image: projectCfg.workerImageDigest, localOnly: false };
}

/**
 * Resolve per-project spawn settings (snapshot flag, image, timeout).
 * Centralises all loadProjectConfig() calls so spawnWorker stays simple.
 */
export async function resolveSpawnSettings(
	projectId: string | null,
	workItemId: string | undefined,
	jobId: string,
): Promise<SpawnSettings> {
	let snapshotEnabled = false;
	let workerImage = routerConfig.workerImage;
	let containerTimeoutMs = routerConfig.workerTimeoutMs;
	let snapshotTtlMs = routerConfig.snapshotDefaultTtlMs;

	if (!projectId) {
		return {
			snapshotEnabled,
			workerImage,
			effectiveBaseImage: workerImage,
			effectiveBaseImageLocalOnly: false,
			workerImageSource: 'default',
			containerTimeoutMs,
			snapshotTtlMs,
		};
	}

	const { fullProjects } = await loadProjectConfig();
	const projectCfg = fullProjects.find((p) => p.id === projectId);

	// Project-level snapshotEnabled overrides the global default.
	snapshotEnabled = projectCfg?.snapshotEnabled ?? routerConfig.snapshotEnabled;

	// Per-project TTL overrides the global default.
	snapshotTtlMs = projectCfg?.snapshotTtlMs ?? routerConfig.snapshotDefaultTtlMs;

	// Per-project worker image (spec 022; dockerfile source added in spec 023).
	// Resolved BEFORE the snapshot block so a reused snapshot is committed/launched
	// on top of the correct base. The verified pin (registry digest for a
	// `reference` image, immutable LOCAL image ID for a `dockerfile`-built image)
	// becomes BOTH the launch image and the effective base; snapshot substitution
	// is layered on top of `effectiveBaseImage` below. `localOnly` (true only for
	// a dockerfile-built base) rides along so container-manager.ts never pulls a
	// purely-local image.
	const workerImageSource: WorkerImageSource = projectCfg?.workerImageSource ?? 'default';
	const { image: effectiveBaseImage, localOnly: effectiveBaseImageLocalOnly } =
		resolveEffectiveBaseImage(projectId, projectCfg);
	workerImage = effectiveBaseImage;

	if (snapshotEnabled && workItemId) {
		const snapshot = getSnapshot(projectId, workItemId, snapshotTtlMs);
		if (snapshot) {
			logger.info('[WorkerManager] Snapshot hit — using snapshot image:', {
				jobId,
				imageName: snapshot.imageName,
				projectId,
				workItemId,
			});
			workerImage = snapshot.imageName;
		} else {
			logger.info('[WorkerManager] Snapshot miss — using base worker image:', {
				jobId,
				projectId,
				workItemId,
			});
		}
	}

	// Use project's watchdogTimeoutMs + buffer if available, falling back to the
	// global workerTimeoutMs. The in-container watchdog fires first; router kill
	// is a backup.
	if (projectCfg?.watchdogTimeoutMs) {
		containerTimeoutMs = projectCfg.watchdogTimeoutMs + ROUTER_KILL_BUFFER_MS;
	}

	// Trace-log the actual values that govern this worker's lifetime so a
	// post-mortem can confirm whether the project's watchdogTimeoutMs override
	// took effect or the global default leaked through.
	logger.info('[WorkerManager] Resolved spawn settings:', {
		jobId,
		projectId,
		workItemId,
		workerImage,
		effectiveBaseImage,
		// The derived image source + local-only flag that governed this run (spec
		// 023). Lets an operator confirm which image kind launched and whether the
		// single-router-daemon (local-only) constraint applied.
		workerImageSource,
		effectiveBaseImageLocalOnly,
		// `projectWorkerImage` is the operator-set reference (null when unset);
		// `globalWorkerImage` is the global default. Together with
		// `effectiveBaseImage` they make a post-mortem able to confirm which image
		// won and whether the per-project override took effect (spec 022, AC #5).
		projectWorkerImage: projectCfg?.workerImage ?? null,
		globalWorkerImage: routerConfig.workerImage,
		snapshotEnabled,
		containerTimeoutMs,
		containerTimeoutMinutes: Math.round(containerTimeoutMs / 60_000),
		projectWatchdogTimeoutMs: projectCfg?.watchdogTimeoutMs ?? null,
		globalWorkerTimeoutMs: routerConfig.workerTimeoutMs,
	});

	return {
		snapshotEnabled,
		workerImage,
		effectiveBaseImage,
		effectiveBaseImageLocalOnly,
		workerImageSource,
		containerTimeoutMs,
		snapshotTtlMs,
	};
}

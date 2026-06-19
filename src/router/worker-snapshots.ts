/**
 * Docker mechanics for CASCADE worker snapshots.
 *
 * Snapshot registry policy lives in snapshot-manager.ts; this module owns the
 * Docker operations needed to name, commit, inspect, and remove worker
 * containers/images during the post-exit lifecycle.
 */

import Docker from 'dockerode';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import { registerSnapshot } from './snapshot-manager.js';

const docker = new Docker();

/**
 * Build a stable Docker image name for a snapshot.
 * Uses a sanitised project+workItem key so it's valid as a Docker image tag.
 */
export function buildWorkerSnapshotImageName(projectId: string, workItemId: string): string {
	// Sanitise: lowercase, replace non-alphanumeric with '-', collapse runs.
	const sanitise = (s: string) =>
		s
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');
	return `cascade-snapshot-${sanitise(projectId)}-${sanitise(workItemId)}:latest`;
}

/**
 * Inspect a snapshot image size without making snapshot registration depend on
 * Docker's image-inspect path. Missing size only affects max-size eviction; TTL
 * and max-count eviction still apply.
 */
async function inspectImageSizeBestEffort(imageName: string): Promise<number | undefined> {
	try {
		const image = docker.getImage(imageName);
		if (!image) return undefined;
		const info = (await image.inspect()) as { Size?: number } | undefined;
		return info?.Size;
	} catch {
		return undefined;
	}
}

/**
 * Commit a worker container to a snapshot image and register the resulting
 * metadata. Snapshot failures are intentionally non-fatal to the worker run.
 */
export async function commitWorkerSnapshot(
	containerId: string,
	projectId: string,
	workItemId: string,
): Promise<void> {
	const imageName = buildWorkerSnapshotImageName(projectId, workItemId);
	try {
		const container = docker.getContainer(containerId);
		await container.commit({ repo: imageName.split(':')[0], tag: 'latest' });
		const imageSize = await inspectImageSizeBestEffort(imageName);
		registerSnapshot(projectId, workItemId, imageName, imageSize);
		logger.info('[WorkerManager] Committed container to snapshot image:', {
			containerId: containerId.slice(0, 12),
			imageName,
			projectId,
			workItemId,
			imageSizeBytes: imageSize,
		});
	} catch (err) {
		logger.warn('[WorkerManager] Failed to commit container to snapshot (non-fatal):', {
			containerId: containerId.slice(0, 12),
			imageName,
			error: String(err),
		});
		captureException(err, {
			tags: { source: 'snapshot_commit' },
			extra: { containerId, imageName, projectId, workItemId },
			level: 'warning',
		});
	}
}

/**
 * Remove a worker container after a snapshot-enabled run. Snapshot containers
 * use AutoRemove=false so they remain available for diagnostics and commit.
 * Removal is best-effort because the container may already be gone.
 */
export async function removeWorkerContainerBestEffort(containerId: string): Promise<void> {
	try {
		const container = docker.getContainer(containerId);
		await container.remove({ force: true });
	} catch {
		// Container may already be removed — not an error.
	}
}

/**
 * Returns true when a Docker error indicates the requested image does not exist.
 * Uses dockerode's HTTP statusCode as the primary signal, with a substring check
 * on the message as a secondary guard.
 */
export function isImageNotFoundError(err: unknown): boolean {
	return (
		err != null &&
		typeof err === 'object' &&
		'statusCode' in err &&
		(err as { statusCode: unknown }).statusCode === 404 &&
		String(err).toLowerCase().includes('no such image')
	);
}

/** Default budget for an on-demand image pull triggered by base-image self-heal. */
export const IMAGE_PULL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Single-flight in-flight pull cache. A second caller for the same image while
 * the first pull is running awaits the same promise instead of triggering a
 * concurrent pull. The entry is cleared on settle so a subsequent prune still
 * triggers a fresh pull next time.
 */
const inFlightPulls = new Map<string, Promise<void>>();

/**
 * Pull a Docker image, deduplicating concurrent requests by image name and
 * enforcing a wall-clock timeout.
 *
 * Used by the spawn self-heal path in `container-manager.ts` when the base
 * worker image was pruned from the host between spawns. Failure cases:
 * - Pull stream emits an error → reject with that error.
 * - Pull exceeds `timeoutMs` → reject with a `pull timeout` error; the
 *   underlying stream is abandoned (no cancel hook in dockerode).
 * - Registry auth missing / network down → propagates the dockerode error;
 *   the caller still has the original 404 to re-throw.
 */
export function pullImageOnce(imageName: string, timeoutMs = IMAGE_PULL_TIMEOUT_MS): Promise<void> {
	const existing = inFlightPulls.get(imageName);
	if (existing) return existing;

	const promise = (async () => {
		const pullStream = (await docker.pull(imageName)) as NodeJS.ReadableStream;
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`pull timeout after ${timeoutMs}ms for ${imageName}`));
			}, timeoutMs);
			docker.modem.followProgress(pullStream, (err: Error | null) => {
				clearTimeout(timer);
				if (err) reject(err);
				else resolve();
			});
		});
	})().finally(() => {
		inFlightPulls.delete(imageName);
	});

	inFlightPulls.set(imageName, promise);
	return promise;
}

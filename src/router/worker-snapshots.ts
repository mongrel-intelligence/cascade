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
import { resolvePullAuthConfig } from './registry-auth.js';
import { registerSnapshot } from './snapshot-manager.js';

const docker = new Docker();

/**
 * Env-var keys that must NEVER be baked into a committed snapshot image.
 *
 * `docker commit` preserves the container's `Config.Env` (every `-e` from the
 * spawn) into the new image. Two problems if left unscrubbed:
 *
 *  1. **Correctness (ucho/MNG-1622 + MNG-1702).** A run that passes its payload
 *     INLINE bakes `JOB_DATA=<json>` into the snapshot. A later run for the same
 *     work item whose payload is large is OFFLOADED (only `JOB_DATA_REDIS_KEY`
 *     is set, not `JOB_DATA`), and `docker run -e JOB_DATA_REDIS_KEY=...` does
 *     not clear the baked `JOB_DATA`. The worker then read the stale baked
 *     payload and ran the wrong (prior) agent. The primary fix is worker-side
 *     (`resolveRawJobData` prefers the Redis key); stripping job env here removes
 *     the stale artifact at the source too.
 *  2. **Security.** The spawn env carries `DATABASE_URL`, `REDIS_URL`, the
 *     project's GitHub/Linear/OpenAI/etc. credentials, and the Claude OAuth
 *     token. Baking them means anyone with Docker/registry access to a
 *     `cascade-snapshot-*` image can read every project secret via
 *     `docker image inspect`.
 *
 * Static deny-set covers job + infra-secret keys; per-project credential names
 * are dynamic and enumerated at runtime from `CASCADE_CREDENTIAL_KEYS`.
 */
const SNAPSHOT_ENV_DENYLIST: ReadonlySet<string> = new Set([
	'JOB_DATA',
	'JOB_DATA_REDIS_KEY',
	'JOB_ID',
	'JOB_TYPE',
	'DATABASE_URL',
	'DATABASE_SSL',
	'DATABASE_CA_CERT',
	'REDIS_URL',
	'CREDENTIAL_MASTER_KEY',
	'CASCADE_CREDENTIAL_KEYS',
	'CLAUDE_CODE_OAUTH_TOKEN',
	'CASCADE_POSTGRES_HOST',
	'CASCADE_POSTGRES_PORT',
	'CASCADE_SNAPSHOT_REUSE',
	'CASCADE_SNAPSHOT_ENABLED',
]);

/** Parse the `KEY` out of a `KEY=VALUE` env line (split on the FIRST `=` only). */
function envKey(line: string): string {
	const eq = line.indexOf('=');
	return eq === -1 ? line : line.slice(0, eq);
}

/**
 * Filter a container's `Config.Env` down to what is safe to bake into a snapshot
 * image: drop the static deny-set plus every dynamic project-credential name
 * listed in `CASCADE_CREDENTIAL_KEYS`. Everything else (PATH, NODE_*, LOG_LEVEL,
 * SENTRY_*, PLAYWRIGHT_BROWSERS_PATH, CASCADE_DASHBOARD_URL, …) is PRESERVED so
 * the snapshot still boots. Pure and total; splits on the first `=` so JSON /
 * connection-string values containing `=` are handled.
 */
export function scrubSnapshotEnv(env: string[], extraCredentialKeys: string[] = []): string[] {
	const deny = new Set<string>(SNAPSHOT_ENV_DENYLIST);
	for (const k of extraCredentialKeys) {
		const trimmed = k.trim();
		if (trimmed) deny.add(trimmed);
	}
	return env.filter((line) => !deny.has(envKey(line)));
}

/** Extract the dynamic project-credential key names from a container's env. */
function extractCredentialKeys(env: string[]): string[] {
	const line = env.find((e) => e.startsWith('CASCADE_CREDENTIAL_KEYS='));
	if (!line) return [];
	return line
		.slice('CASCADE_CREDENTIAL_KEYS='.length)
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Compute the `changes` (Dockerfile `ENV KEY=` instructions) that BLANK the
 * value of every deny-listed / credential env var actually present in `env`.
 *
 * WHY blank-via-changes and not a scrubbed `Env` body: `docker commit` cannot
 * REMOVE an env var. The `POST /commit` body's `Env` list does not replace the
 * container's env — moby re-appends every container env var whose key is absent
 * from the body, so a "scrubbed Env body" is a **silent no-op** (verified
 * against a live daemon: `JOB_DATA` / secrets survive unchanged, byte-identical
 * to a bare commit). The supported mechanism is the `changes` param — Dockerfile
 * instructions applied to the committed image — where `ENV KEY=` sets the value
 * to empty. Empty `JOB_DATA` is falsy (the worker ignores it), and an emptied
 * secret carries no value to leak. `Cmd` / `Entrypoint` / `WorkingDir` and every
 * other env var are preserved by the daemon (a bare commit keeps the full
 * container config; `changes` only overlays the named ENV keys). Only keys
 * PRESENT in the env are blanked, so no spurious empty vars are introduced.
 */
export function buildSnapshotEnvScrubChanges(env: string[]): string[] {
	const deny = new Set<string>(SNAPSHOT_ENV_DENYLIST);
	for (const k of extractCredentialKeys(env)) deny.add(k);
	const present = new Set<string>();
	for (const line of env) {
		const key = envKey(line);
		if (deny.has(key)) present.add(key);
	}
	return [...present].map((key) => `ENV ${key}=`);
}

/**
 * Commit `container` to `imageName` with its job + secret env vars blanked.
 *
 * Inspects the container's live `Config.Env`, then commits with `changes` that
 * empty the value of every deny-listed / credential key present (see
 * `buildSnapshotEnvScrubChanges` for why `changes` and not an `Env` body — the
 * latter is a proven no-op). `Cmd`/`Entrypoint`/`WorkingDir`/all other env are
 * preserved, so a reused snapshot still boots.
 *
 * If inspect fails or the env is empty, falls back to a bare commit (an
 * unscrubbed but working snapshot) and captures Sentry under
 * `snapshot_env_scrub_inspect_failed` so the regression to baking secrets is
 * loud rather than silent.
 */
async function commitScrubbed(
	container: Docker.Container,
	repo: string,
	imageName: string,
): Promise<void> {
	let env: string[] | undefined;
	try {
		const info = (await container.inspect()) as { Config?: { Env?: string[] } } | undefined;
		env = info?.Config?.Env;
	} catch (inspectErr) {
		captureException(inspectErr, {
			tags: { source: 'snapshot_env_scrub_inspect_failed' },
			extra: { imageName },
			level: 'warning',
		});
	}

	if (Array.isArray(env) && env.length > 0) {
		const changes = buildSnapshotEnvScrubChanges(env);
		if (changes.length > 0) {
			await container.commit({ repo, tag: 'latest', changes });
			logger.info('[WorkerManager] Snapshot committed with blanked job/secret env', {
				imageName,
				blankedKeys: changes.length,
			});
			return;
		}
	}

	// inspect unavailable / empty env / nothing to blank → bare config-preserving commit.
	await container.commit({ repo, tag: 'latest' });
}

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
		await commitScrubbed(container, imageName.split(':')[0], imageName);
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
		// Private registries need explicit auth on every pull — dockerode sends
		// none by default and the daemon has no login of its own.
		const authconfig = resolvePullAuthConfig(imageName);
		const pullStream = (await docker.pull(
			imageName,
			authconfig ? { authconfig } : {},
		)) as NodeJS.ReadableStream;
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

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface DescriptionMutationLockOptions {
	lockDir?: string;
	timeoutMs?: number;
	staleMs?: number;
	pollMs?: number;
}

interface LockFileContents {
	token: string;
	createdAt: number;
	pid: number;
}

export const DEFAULT_DESCRIPTION_MUTATION_LOCK_TIMEOUT_MS = 45_000;
const DEFAULT_STALE_MS = 120_000;
const DEFAULT_POLL_MS = 25;
const LOCK_DIR_ENV = 'CASCADE_DESCRIPTION_MUTATION_LOCK_DIR';

/**
 * TTL for the cross-process description sidecar files.  Must comfortably
 * exceed the provider's eventual-consistency window so the fresh base
 * written by one process is still readable by the next process that
 * acquires the lock.  60 s matches the in-process recent-description
 * cache TTL in the Linear adapter.
 */
const SIDECAR_TTL_MS = 60_000;

function getSidecarPath(lockDir: string, provider: string, workItemId: string): string {
	return join(lockDir, `${sanitizePathPart(provider)}-${sanitizePathPart(workItemId)}.desc.json`);
}

/**
 * Read the description written by the most-recent locked mutation for
 * `(provider, workItemId)`.  Returns `undefined` when no recent sidecar
 * exists or it has expired.
 *
 * **Must be called while holding the description mutation lock** for the
 * same (provider, workItemId) pair so the read-and-use is atomic across
 * concurrent processes.
 */
export async function readLockedDescription(
	provider: string,
	workItemId: string,
	options: DescriptionMutationLockOptions = {},
): Promise<string | undefined> {
	const settings = resolveOptions(options);
	const sidecarPath = getSidecarPath(settings.lockDir, provider, workItemId);
	try {
		const raw = await readFile(sidecarPath, 'utf8');
		const data = JSON.parse(raw) as { description: string; timestamp: number };
		if (typeof data.description !== 'string' || typeof data.timestamp !== 'number') {
			return undefined;
		}
		if (Date.now() - data.timestamp > SIDECAR_TTL_MS) {
			await unlink(sidecarPath).catch(() => {});
			return undefined;
		}
		return data.description;
	} catch {
		return undefined;
	}
}

/**
 * Persist the description that was just written so that a subsequent locked
 * mutation in a **different process** can use it as a fresh base rather than
 * reading a stale snapshot from the PM provider.
 *
 * **Must be called while holding the description mutation lock** for the
 * same (provider, workItemId) pair, immediately after a successful PUT.
 * Best-effort: failures are non-fatal because the in-process cache still
 * handles same-process retries.
 */
export async function writeLockedDescription(
	provider: string,
	workItemId: string,
	description: string,
	options: DescriptionMutationLockOptions = {},
): Promise<void> {
	const settings = resolveOptions(options);
	await mkdir(settings.lockDir, { recursive: true });
	const sidecarPath = getSidecarPath(settings.lockDir, provider, workItemId);
	await writeFile(sidecarPath, JSON.stringify({ description, timestamp: Date.now() }), 'utf8');
}

export async function withDescriptionMutationLock<T>(
	provider: string,
	workItemId: string,
	fn: () => Promise<T>,
	options: DescriptionMutationLockOptions = {},
): Promise<T> {
	const settings = resolveOptions(options);
	const lockPath = join(
		settings.lockDir,
		`${sanitizePathPart(provider)}-${sanitizePathPart(workItemId)}.lock`,
	);
	const token = randomUUID();

	await mkdir(settings.lockDir, { recursive: true });
	await acquireLock(lockPath, token, settings);
	try {
		return await fn();
	} finally {
		await releaseLock(lockPath, token);
	}
}

function resolveOptions(
	options: DescriptionMutationLockOptions,
): Required<DescriptionMutationLockOptions> {
	return {
		lockDir:
			options.lockDir ?? process.env[LOCK_DIR_ENV] ?? join(tmpdir(), 'cascade-description-locks'),
		timeoutMs: options.timeoutMs ?? DEFAULT_DESCRIPTION_MUTATION_LOCK_TIMEOUT_MS,
		staleMs: options.staleMs ?? DEFAULT_STALE_MS,
		pollMs: options.pollMs ?? DEFAULT_POLL_MS,
	};
}

async function acquireLock(
	lockPath: string,
	token: string,
	options: Required<DescriptionMutationLockOptions>,
): Promise<void> {
	const startedAt = Date.now();
	const deadline = startedAt + options.timeoutMs;
	const contents: LockFileContents = { token, createdAt: startedAt, pid: process.pid };

	while (true) {
		try {
			const file = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
			try {
				await file.writeFile(JSON.stringify(contents));
			} finally {
				await file.close();
			}
			return;
		} catch (err) {
			if (!isFileExistsError(err)) throw err;
		}

		await removeStaleLock(lockPath, options.staleMs);
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for description mutation lock: ${lockPath}`);
		}
		await sleep(jitter(options.pollMs));
	}
}

async function removeStaleLock(lockPath: string, staleMs: number): Promise<void> {
	try {
		const lockStat = await stat(lockPath);
		const ageMs = Date.now() - lockStat.mtimeMs;
		if (ageMs <= staleMs) return;
		await unlink(lockPath);
	} catch (err) {
		if (!isMissingFileError(err)) throw err;
	}
}

async function releaseLock(lockPath: string, token: string): Promise<void> {
	try {
		const raw = await readFile(lockPath, 'utf8');
		const parsed = JSON.parse(raw) as Partial<LockFileContents>;
		if (parsed.token !== token) return;
		await unlink(lockPath);
	} catch (err) {
		if (!isMissingFileError(err)) throw err;
	}
}

function sanitizePathPart(value: string): string {
	const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
	return sanitized || 'unknown';
}

function jitter(baseMs: number): number {
	return baseMs + Math.floor(Math.random() * baseMs);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFileExistsError(err: unknown): boolean {
	return isNodeError(err) && err.code === 'EEXIST';
}

function isMissingFileError(err: unknown): boolean {
	return isNodeError(err) && err.code === 'ENOENT';
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return err instanceof Error && 'code' in err;
}

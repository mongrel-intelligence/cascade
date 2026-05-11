import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
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

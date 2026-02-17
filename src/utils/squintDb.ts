import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, unlinkSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Resolve the effective Squint DB path: SQUINT_DB_PATH env var, or .squint.db in repoDir.
 * Returns null if neither exists.
 */
export function resolveSquintDbPath(repoDir: string): string | null {
	const envPath = process.env.SQUINT_DB_PATH;
	if (envPath && existsSync(envPath)) return envPath;

	const localPath = join(repoDir, '.squint.db');
	if (existsSync(localPath)) return localPath;

	return null;
}

/**
 * If .squint.db is missing from repoDir but project has a squintDbUrl,
 * download it to a temp file and set SQUINT_DB_PATH in process.env.
 * Returns a cleanup function (or null if nothing was downloaded).
 */
export async function setupRemoteSquintDb(
	repoDir: string,
	project: { squintDbUrl?: string },
	log: {
		info: (msg: string, ctx?: Record<string, unknown>) => void;
		warn: (msg: string, ctx?: Record<string, unknown>) => void;
	},
): Promise<(() => void) | null> {
	// Local DB takes precedence
	if (existsSync(join(repoDir, '.squint.db'))) return null;

	if (!project.squintDbUrl) return null;

	const tempPath = join(tmpdir(), `cascade-squint-${randomUUID()}.db`);
	const startTime = Date.now();

	try {
		const response = await fetch(project.squintDbUrl);
		if (!response.ok) {
			log.warn('Failed to download remote Squint DB', {
				url: project.squintDbUrl,
				status: response.status,
			});
			return null;
		}

		if (!response.body) {
			log.warn('Remote Squint DB response has no body', { url: project.squintDbUrl });
			return null;
		}

		const writeStream = createWriteStream(tempPath);
		await pipeline(
			Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
			writeStream,
		);

		const fileInfo = await stat(tempPath);
		const durationMs = Date.now() - startTime;

		log.info('Downloaded remote Squint DB', {
			url: project.squintDbUrl,
			path: tempPath,
			sizeBytes: fileInfo.size,
			durationMs,
		});

		process.env.SQUINT_DB_PATH = tempPath;

		return () => {
			try {
				if (existsSync(tempPath)) unlinkSync(tempPath);
			} catch {
				// Ignore cleanup errors
			}
			process.env.SQUINT_DB_PATH = undefined;
		};
	} catch (err) {
		log.warn('Failed to download remote Squint DB', {
			url: project.squintDbUrl,
			error: String(err),
		});
		// Clean up partial download
		try {
			if (existsSync(tempPath)) unlinkSync(tempPath);
		} catch {
			// Ignore
		}
		return null;
	}
}

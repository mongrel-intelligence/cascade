/**
 * Synchronous validation for operator-supplied worker Dockerfile CONTENT
 * (spec 023 plan 4). The set-Dockerfile mutation runs this cheap, Docker-free
 * structural gate BEFORE persisting, so malformed content is rejected with
 * `BAD_REQUEST` (nothing persisted) rather than failing deep inside the
 * router-side build. Mirrors `isValidImageReference` in `workerImageRef.ts`.
 *
 * Operators supply EXTRA layers only — CASCADE prepends the pinned base `FROM`
 * itself in `composeDockerfile` (`src/router/worker-dockerfile-compose.ts`).
 * Content that declared its own `FROM` would let an operator escape the audited,
 * digest-pinned base image entirely, so it is rejected here (and again
 * defensively at compose time via `assertNoFromLine`).
 */

/**
 * Generous upper bound on operator Dockerfile content (64 KiB). A real
 * extra-layers Dockerfile is a few hundred bytes; this cap exists only to reject
 * pathological input before it reaches the DB / build engine. Measured in UTF-8
 * BYTES (not code points) so multi-byte characters cannot smuggle past it.
 */
export const WORKER_DOCKERFILE_MAX_BYTES = 64 * 1024;

export interface WorkerDockerfileValidationResult {
	valid: boolean;
	error?: string;
}

/**
 * Returns `{ valid: true }` when `content` is acceptable operator Dockerfile
 * content, otherwise `{ valid: false, error }` with a precise reason.
 *
 * Rejections:
 *   - empty / whitespace-only content
 *   - content whose UTF-8 byte length exceeds {@link WORKER_DOCKERFILE_MAX_BYTES}
 *   - any non-comment line that begins with a `FROM` instruction (case-insensitive,
 *     tolerant of leading whitespace) — CASCADE owns the base `FROM`
 */
export function validateWorkerDockerfileContent(content: string): WorkerDockerfileValidationResult {
	if (typeof content !== 'string' || content.trim().length === 0) {
		return { valid: false, error: 'Worker Dockerfile content must not be empty' };
	}

	const byteLength = Buffer.byteLength(content, 'utf-8');
	if (byteLength > WORKER_DOCKERFILE_MAX_BYTES) {
		return {
			valid: false,
			error: `Worker Dockerfile content exceeds the ${WORKER_DOCKERFILE_MAX_BYTES}-byte limit (got ${byteLength})`,
		};
	}

	// Mirror `assertNoFromLine` in worker-dockerfile-compose.ts: ignore blank and
	// comment lines; reject any remaining line that opens with a `FROM` instruction.
	const lines = content.replace(/\r\n/g, '\n').split('\n');
	for (const raw of lines) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		if (/^FROM(\s|$)/i.test(line)) {
			return {
				valid: false,
				error:
					'Worker Dockerfile content must not contain its own FROM instruction; ' +
					'CASCADE prepends the pinned base image automatically (supply extra layers only)',
			};
		}
	}

	return { valid: true };
}

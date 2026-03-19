/**
 * Shared engine log appender for native-tool engine subprocesses.
 *
 * Extracted from codex/index.ts and opencode/index.ts where it was duplicated
 * verbatim. Both engines call this to stream raw subprocess output to the
 * per-run engine log file on disk.
 */

import { appendFileSync } from 'node:fs';

/**
 * Append a chunk of text to the engine log file at the given path.
 * No-ops silently when path is undefined or chunk is empty.
 */
export function appendEngineLog(path: string | undefined, chunk: string): void {
	if (!path || chunk.length === 0) return;
	appendFileSync(path, chunk, 'utf-8');
}

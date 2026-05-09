/**
 * Pin: cascade-tools' stdout carries only the JSON envelope.
 *
 * Prod regression 2026-05-09 (62% of cascade-tools calls polluted): the
 * worker process at `src/backends/llmist/index.ts:83-84` sets
 * `LLMIST_LOG_FILE=<engineLogPath>` AND `LLMIST_LOG_TEE='true'` so its OWN
 * logger tees writes to both the engine log file AND stdout. Both env vars
 * are in the subprocess allowlist (`src/utils/cascadeEnv.ts:14-15`), so they
 * pass through to the bash subprocess that runs cascade-tools — and the
 * cascade-tools logger ALSO tees to stdout, polluting the agent's tool-result
 * channel with DEBUG/INFO + ANSI escape codes before the JSON envelope.
 *
 * The fix at `bin/cascade-tools.js` strips the inherited tee BEFORE the
 * logger singleton is constructed. With LLMIST_LOG_FILE still set, all log
 * lines (including the load-bearing `[image-pipeline] work-item-fetch
 * summary` per spec 016) land in the engine log the worker collects —
 * operator observability via `cascade runs logs <runId>` is preserved.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const BIN = resolve(REPO_ROOT, 'bin/cascade-tools.js');
const DIST = resolve(REPO_ROOT, 'dist/cli/bootstrap.js');

// ESC byte (0x1b). Build at runtime so biome's `noControlCharactersInRegex`
// auto-fixer can't fold this back into a regex literal containing ESC.
const ESC = String.fromCharCode(0x1b);
const LOG_LEVEL_PREFIX = /\t(DEBUG|INFO|WARN|ERROR)\t/;
const ENVELOPE_START = /^\{"success":(true|false)/;

let scratchDir: string;

beforeEach(() => {
	scratchDir = mkdtempSync(join(tmpdir(), 'cascade-tools-stdout-test-'));
});

afterEach(() => {
	rmSync(scratchDir, { recursive: true, force: true });
});

function runCascadeTools(
	args: string[],
	envOverrides: Record<string, string>,
): { stdout: string; stderr: string; code: number | null } {
	// Strip NODE_ENV — vitest sets it to 'test' which trips the integration
	// entrypoint loaded by `bin/cascade-tools.js` and exits 2 without diagnostic.
	// Unrelated to the stdout-cleanliness invariant under test.
	const env: NodeJS.ProcessEnv = { ...process.env, ...envOverrides };
	delete env.NODE_ENV;
	const result = spawnSync('node', [BIN, ...args], {
		cwd: REPO_ROOT,
		encoding: 'utf-8',
		env,
		timeout: 30_000,
	});
	return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status };
}

describe('cascade-tools — stdout is reserved for the JSON envelope', () => {
	const built = existsSync(DIST);

	it.skipIf(!built)(
		'under worker-shaped env (LLMIST_LOG_TEE=true + LLMIST_LOG_FILE=<file>), stdout is envelope-only',
		() => {
			const engineLog = join(scratchDir, 'engine.log');
			// `pm read-work-item` against an obviously-fake workItemId hits a
			// runtime failure inside the Trello/JIRA/Linear client, which emits
			// `Fetching ... { ... }` debug lines BEFORE failing. Pre-fix, those
			// debug lines land on stdout. Post-fix, they land in the engine log
			// file (asserted in the next test).
			const { stdout } = runCascadeTools(
				['pm', 'read-work-item', '--workItemId', 'NOT-A-REAL-WORK-ITEM'],
				{ LLMIST_LOG_TEE: 'true', LLMIST_LOG_FILE: engineLog },
			);

			expect(stdout).toMatch(ENVELOPE_START);
			expect(stdout).not.toContain(ESC);
			expect(stdout).not.toMatch(LOG_LEVEL_PREFIX);
			expect(stdout).not.toContain('[cascade]');
		},
	);

	it.skipIf(!built)(
		'engine log file still receives logger output (operator observability preserved)',
		() => {
			const engineLog = join(scratchDir, 'engine.log');
			runCascadeTools(['pm', 'read-work-item', '--workItemId', 'NOT-A-REAL-WORK-ITEM'], {
				LLMIST_LOG_TEE: 'true',
				LLMIST_LOG_FILE: engineLog,
			});

			expect(existsSync(engineLog)).toBe(true);
			const fileContent = readFileSync(engineLog, 'utf-8');
			// At least one cascade-emitted log line landed in the file.
			expect(fileContent).toContain('[cascade]');
		},
	);

	it.skipIf(!built)(
		'standalone CLI (no LLMIST_LOG_FILE inherited) keeps stdout envelope-only',
		() => {
			// Dev-style invocation — no engine log file in env. Pre-fix, llmist
			// defaults to stdout; post-fix, the entrypoint redirects to /dev/null.
			const env = { ...process.env };
			delete env.NODE_ENV;
			delete env.LLMIST_LOG_FILE;
			delete env.LLMIST_LOG_TEE;
			const result = spawnSync(
				'node',
				[BIN, 'pm', 'read-work-item', '--workItemId', 'NOT-A-REAL-WORK-ITEM'],
				{ cwd: REPO_ROOT, encoding: 'utf-8', env, timeout: 30_000 },
			);
			const stdout = result.stdout ?? '';
			expect(stdout).toMatch(ENVELOPE_START);
			expect(stdout).not.toContain(ESC);
			expect(stdout).not.toContain('[cascade]');
		},
	);
});

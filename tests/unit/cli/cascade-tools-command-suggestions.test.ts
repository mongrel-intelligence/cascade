/**
 * Pin the spawn-level `command_not_found` behavior of `cascade-tools` (MNG-1442).
 *
 * The pure suggestion helper is covered by
 * `tests/unit/cli/command-suggestions.test.ts`. This file covers the WIRING:
 *
 * - The oclif `command_not_found` hook is actually installed for the
 *   `cascade-tools` binary (not just the helper).
 * - A typoed topic (`sm get-pr-diff`) and a typoed subcommand
 *   (`pm reaad-work-item`) each surface a structured JSON envelope on
 *   stdout, a one-line prose summary on stderr, and exit code `2`.
 * - A typo that is far from every candidate drops the `hint` field but
 *   still surfaces an `expected` candidate enumeration so the agent has a
 *   concrete recovery path.
 * - The existing `unknown-flag` handling for valid commands keeps emitting
 *   `unknown-flag` from `createCLICommand()` — unknown-command logic must
 *   not regress the flag-suggestion path.
 *
 * Tests skip with a clear message when the repo has not been built (the
 * binary at `bin/cascade-tools.js` requires `dist/cli/bootstrap.js` before
 * oclif can route any command, including the not-found hook). This mirrors
 * `tests/unit/cli/cascade-tools-help.test.ts`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const BIN = resolve(REPO_ROOT, 'bin/cascade-tools.js');
const DIST = resolve(REPO_ROOT, 'dist/cli/bootstrap.js');
const HOOK_DIST = resolve(REPO_ROOT, 'dist/cli/_shared/command-not-found-hook.js');

interface SpawnResult {
	stdout: string;
	stderr: string;
	code: number | null;
}

function runCascadeTools(args: string[]): SpawnResult {
	// Strip NODE_ENV — vitest sets it to 'test' which trips the integration
	// entrypoint loaded by `bin/cascade-tools.js` and exits 2 with no
	// diagnostic. Unrelated to the unknown-command behavior under test.
	const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' };
	delete env.NODE_ENV;
	const result = spawnSync('node', [BIN, ...args], {
		cwd: REPO_ROOT,
		encoding: 'utf-8',
		env,
		timeout: 30_000,
	});
	return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status };
}

interface UnknownCommandEnvelope {
	success: false;
	error: {
		type: 'unknown-command';
		message: string;
		got?: string;
		expected?: string;
		hint?: string;
	};
}

interface UnknownFlagEnvelope {
	success: false;
	error: {
		type: 'unknown-flag';
		flag?: string;
		message: string;
	};
}

function parseEnvelope<T>(stdout: string): T {
	const trimmed = stdout.trim();
	// Each spec-014 envelope is a single JSON line — but defensively parse the
	// last non-empty line in case oclif ever prepends warnings.
	const lastLine = trimmed.split(/\n+/).pop() ?? '';
	return JSON.parse(lastLine) as T;
}

describe('cascade-tools command_not_found hook (MNG-1442)', () => {
	const built = existsSync(DIST) && existsSync(HOOK_DIST);

	it.skipIf(!built)(
		'unknown topic `sm get-pr-diff` emits unknown-command JSON envelope on stdout with a `scm get-pr-diff` hint',
		() => {
			const result = runCascadeTools(['sm', 'get-pr-diff']);
			expect(result.code).toBe(2);

			const env = parseEnvelope<UnknownCommandEnvelope>(result.stdout);
			expect(env.success).toBe(false);
			expect(env.error.type).toBe('unknown-command');
			expect(env.error.hint).toBe("did you mean 'cascade-tools scm get-pr-diff'?");
			expect(env.error.got).toBe('sm get-pr-diff');
			// Topic-level enumeration so the agent sees the four candidates even
			// when the hint already nails it.
			expect((env.error.expected ?? '').split(', ')).toEqual(
				expect.arrayContaining(['alerting', 'pm', 'scm', 'session']),
			);

			// Prose summary on stderr — one line, humans-readable, no JSON.
			expect(result.stderr.trim().split('\n').length).toBe(1);
			expect(result.stderr).toContain('unknown-command');
			expect(result.stderr).not.toContain('{"success"');
		},
	);

	it.skipIf(!built)(
		'unknown subcommand `pm reaad-work-item` emits unknown-command JSON with a `pm read-work-item` hint',
		() => {
			const result = runCascadeTools(['pm', 'reaad-work-item']);
			expect(result.code).toBe(2);

			const env = parseEnvelope<UnknownCommandEnvelope>(result.stdout);
			expect(env.success).toBe(false);
			expect(env.error.type).toBe('unknown-command');
			expect(env.error.hint).toBe("did you mean 'cascade-tools pm read-work-item'?");
			expect(env.error.got).toBe('pm reaad-work-item');
			// Subcommand-level enumeration: must include sibling pm commands and
			// must NOT leak other topics' subcommands (e.g. scm:create-pr).
			expect(env.error.expected).toContain('read-work-item');
			expect(env.error.expected).not.toContain('create-pr');
		},
	);

	it.skipIf(!built)(
		'far-away typos omit the `hint` field but still surface the candidate enumeration',
		() => {
			// `zzzzzzzz` is well beyond the distance budget for any registered
			// topic. The agent should still get a runnable list of candidates.
			const result = runCascadeTools(['zzzzzzzz', 'something']);
			expect(result.code).toBe(2);

			const env = parseEnvelope<UnknownCommandEnvelope>(result.stdout);
			expect(env.error.type).toBe('unknown-command');
			expect(env.error.hint).toBeUndefined();
			expect((env.error.expected ?? '').split(', ')).toEqual(
				expect.arrayContaining(['alerting', 'pm', 'scm', 'session']),
			);
		},
	);

	it.skipIf(!built)(
		'far-away subcommand typo on a known topic also omits `hint` but lists subcommands',
		() => {
			// `totallyunrelated` shares almost nothing with any pm subcommand —
			// confirms the noise gate applies on the subcommand path too.
			const result = runCascadeTools(['pm', 'totallyunrelated']);
			expect(result.code).toBe(2);

			const env = parseEnvelope<UnknownCommandEnvelope>(result.stdout);
			expect(env.error.type).toBe('unknown-command');
			expect(env.error.hint).toBeUndefined();
			expect(env.error.expected).toContain('read-work-item');
			expect(env.error.expected).not.toContain('create-pr');
		},
	);

	it.skipIf(!built)(
		'existing unknown-flag handling is untouched (regression net for createCLICommand())',
		() => {
			// `pm read-work-item` is a real command; `--unknownflag` is not.
			// The unknown-flag envelope is emitted by `createCLICommand()`'s
			// parse-error classifier, not by the command_not_found hook. This
			// test pins that the new hook does NOT shadow that path.
			const result = runCascadeTools([
				'pm',
				'read-work-item',
				'--workItemId',
				'foo',
				'--unknownflag',
				'bar',
			]);
			// `unknown-flag` exits with code 1 (the spec-014 default for every
			// non-command envelope); a successful exit (0) or `unknown-command`
			// (2) would each be a regression.
			expect(result.code).toBe(1);

			const env = parseEnvelope<UnknownFlagEnvelope>(result.stdout);
			expect(env.success).toBe(false);
			expect(env.error.type).toBe('unknown-flag');
		},
	);
});

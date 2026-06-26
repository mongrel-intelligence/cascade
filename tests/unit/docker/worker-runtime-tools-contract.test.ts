import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
	buildWorkerImageCheckScript,
	WORKER_IMAGE_HARD_CHECKS,
	WORKER_IMAGE_VALIDATION_CHECKS,
} from '../../../src/router/worker-image-checks.js';

/**
 * Spec 022 plan 3/4 — the cascade-compatible-worker-image runtime contract.
 *
 * `src/router/worker-image-checks.ts` is the single source of truth for the
 * in-container checks; the CI smoke-test (`run-test.sh`) and the router-side
 * validator both consume it. These tests pin both surfaces to the same required
 * commands so they cannot drift.
 */

const REQUIRED_COMMANDS = ['cascade-tools --version', 'node --version', 'git --version'];

function readRunTestScript(): string {
	const path = fileURLToPath(
		new URL('../../docker/worker-runtime-tools/run-test.sh', import.meta.url),
	);
	return readFileSync(path, 'utf8');
}

describe('worker image runtime-tools contract', () => {
	it('the required-check list asserts cascade-tools, node, git, and an engine CLI', () => {
		const commands = WORKER_IMAGE_HARD_CHECKS.map((c) => c.command);

		for (const required of REQUIRED_COMMANDS) {
			expect(commands).toContain(required);
		}

		// At least one engine CLI must be on PATH (claude / codex / opencode).
		const engineCheck = WORKER_IMAGE_HARD_CHECKS.find((c) =>
			/claude|codex|opencode/.test(c.command),
		);
		expect(engineCheck).toBeDefined();
		expect(engineCheck?.command).toContain('command -v claude');
		expect(engineCheck?.command).toContain('codex');
		expect(engineCheck?.command).toContain('opencode');
	});

	it('the built check script runs every validation check and fails fast on a missing tool', () => {
		const script = buildWorkerImageCheckScript();

		for (const check of WORKER_IMAGE_VALIDATION_CHECKS) {
			expect(script).toContain(check.command);
		}
		// Fail-fast + grep-stable reason line the validator surfaces. The label is
		// emitted via `printf '...%s...' '<label>'` (not interpolated into a
		// double-quoted echo), so it appears as a single-quoted printf argument.
		expect(script).toContain('FAIL: %s check failed');
		expect(script).toContain("'cascade-tools'");
		expect(script).toContain('exit 1');
		expect(script).toContain('cascade-worker-image-checks OK');
	});

	it('generates a script that PARSES under bash -n (regression: MNG-1698)', () => {
		// Root-cause regression for MNG-1698. The Playwright SOFT check command
		// (`node -e "require('@playwright/test/package.json')"`) contains literal
		// double quotes. The previous generator embedded the raw command into a
		// double-quoted `echo "FAIL: ... (${command})"`; the inner `"` closed the
		// string and left `(` unquoted, so bash aborted with a syntax error at
		// PARSE time — before any check ran — and every candidate image (valid or
		// not) was marked `failed`. Pipe the real generated script through
		// `bash -n` (parse-only, no execution), exactly as the validator runs it
		// (`bash -lc <script>`), to prove it parses.
		const script = buildWorkerImageCheckScript();
		const result = spawnSync('bash', ['-n', '-c', script], { encoding: 'utf8' });

		expect(result.error).toBeUndefined();
		expect(result.stderr).not.toContain('syntax error');
		expect(result.status).toBe(0);
	});

	it('emits a grep-stable `FAIL: <label>` line at runtime when a check fails', () => {
		// A failing check must print a line starting with `FAIL:` so the validator's
		// summarizeFailure() can surface a precise reason. Force a failure with a
		// label that itself contains shell metacharacters (parens, mirroring the
		// real engine-CLI label) to prove the single-quote escaping holds and the
		// metacharacters are printed literally (not executed).
		const script = buildWorkerImageCheckScript([
			{ label: 'engine CLI (claude/codex/opencode)', command: 'false' },
		]);
		const result = spawnSync('bash', ['-lc', script], { encoding: 'utf8' });

		expect(result.status).toBe(1);
		const failLine = result.stderr
			.split('\n')
			.map((l) => l.trim())
			.find((l) => l.startsWith('FAIL:'));
		expect(failLine).toBe('FAIL: engine CLI (claude/codex/opencode) check failed');
	});

	it('the CI smoke-test (run-test.sh) asserts the same HARD contract commands', () => {
		const script = readRunTestScript();

		for (const required of REQUIRED_COMMANDS) {
			expect(script).toContain(required);
		}
		// Engine CLI presence and the existing python/Playwright blocks remain.
		expect(script).toContain('command -v claude');
		expect(script).toContain('python --version');
		expect(script).toContain('PLAYWRIGHT_BROWSERS_PATH');
	});
});

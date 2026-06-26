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
		// Fail-fast + grep-stable reason line the validator surfaces.
		expect(script).toContain('FAIL: cascade-tools check failed');
		expect(script).toContain('exit 1');
		expect(script).toContain('cascade-worker-image-checks OK');
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

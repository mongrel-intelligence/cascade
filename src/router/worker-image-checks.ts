/**
 * The cascade-compatible-worker-image runtime contract (spec 022).
 *
 * This module is the SINGLE SOURCE OF TRUTH for the in-container checks that
 * decide whether a candidate worker image can host a CASCADE agent run. Two
 * surfaces consume it:
 *
 *   1. The CI smoke-test (`tests/docker/worker-runtime-tools/run-test.sh`), which
 *      gates promotion of the global worker image.
 *   2. The router-side per-project image validator
 *      (`src/router/worker-image-validation.ts`), which runs these exact checks
 *      inside an operator-supplied image before pinning its digest.
 *
 * Keeping the list here (Docker-free, zero imports) lets a unit test exercise the
 * required-check list without Docker, and lets the validator run the same checks
 * the CI smoke-test asserts. The contract test
 * (`tests/unit/docker/worker-runtime-tools-contract.test.ts`) pins both this list
 * and `run-test.sh` to the same required commands so they cannot drift.
 */

/** A single required runtime check the worker image must satisfy. */
export interface WorkerImageCheck {
	/** Short label naming the tool being checked (used in the failure message). */
	label: string;
	/** Bash command whose non-zero exit means the check failed. */
	command: string;
}

/**
 * HARD checks — every cascade-compatible worker image MUST satisfy these or the
 * agent cannot run at all: the compiled CLI (`cascade-tools`), the Node runtime,
 * `git`, and at least one engine CLI on PATH. Mirrors the "HARD" half of the
 * spec-022 image contract.
 */
export const WORKER_IMAGE_HARD_CHECKS: readonly WorkerImageCheck[] = [
	{ label: 'cascade-tools', command: 'cascade-tools --version' },
	{ label: 'node', command: 'node --version' },
	{ label: 'git', command: 'git --version' },
	{
		label: 'engine CLI (claude/codex/opencode)',
		command: 'command -v claude || command -v codex || command -v opencode',
	},
];

/**
 * SOFT checks — strongly expected for a fully-featured agent run but not strictly
 * required to boot CASCADE. Validation still asserts them (they are part of the
 * extended smoke-test, AC #3) but they are a separate list so the HARD contract
 * stays explicit. Playwright is verified by package presence only — a full
 * Chromium launch belongs in the CI smoke-test, not the per-project validator.
 */
export const WORKER_IMAGE_SOFT_CHECKS: readonly WorkerImageCheck[] = [
	{ label: 'python shim', command: 'python --version' },
	{
		label: 'playwright',
		command: 'NODE_PATH=$(npm root -g) node -e "require(\'@playwright/test/package.json\')"',
	},
];

/**
 * The full set of checks the per-project validator runs inside a candidate image
 * (HARD + SOFT). A non-zero exit on ANY check fails validation with a precise
 * reason naming the failing tool.
 */
export const WORKER_IMAGE_VALIDATION_CHECKS: readonly WorkerImageCheck[] = [
	...WORKER_IMAGE_HARD_CHECKS,
	...WORKER_IMAGE_SOFT_CHECKS,
];

/**
 * Build a single bash script that runs every supplied check in order, failing
 * fast with a grep-stable `FAIL: <label> ...` line on stderr so the validator can
 * surface a precise reason. The script is passed verbatim as one argv element to
 * `bash -lc` (via dockerode), so it is NOT re-parsed by an outer shell — single
 * quotes inside double quotes are safe here.
 */
export function buildWorkerImageCheckScript(
	checks: readonly WorkerImageCheck[] = WORKER_IMAGE_VALIDATION_CHECKS,
): string {
	const lines = ['set -u'];
	for (const check of checks) {
		lines.push(
			`if ! { ${check.command} ; } >/dev/null 2>&1 ; then echo "FAIL: ${check.label} check failed (${check.command})" >&2 ; exit 1 ; fi`,
		);
	}
	lines.push('echo "cascade-worker-image-checks OK"');
	return lines.join('\n');
}

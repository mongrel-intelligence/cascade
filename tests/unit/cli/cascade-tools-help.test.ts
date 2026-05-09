/**
 * Pin the topic-list rendering of `cascade-tools --help`.
 *
 * Prod regression 2026-05-09: when `pjson.oclif.topics` is unset, oclif
 * borrows each topic's description from its FIRST command (see
 * `node_modules/@oclif/core/lib/config/config.js:297-300`). That made bare
 * `cascade-tools --help` show:
 *   - `pm` topic = description of `pm add-checklist` ("Add a checklist...")
 *   - `scm` topic = description of `scm create-pr`
 *   - `alerting` topic = description of `alerting get-alerting-event`
 *   - `session` topic = description of `session finish`
 *
 * Agents reading bare `--help` to map the surface get a misleading frame and
 * make wrong assumptions. The fix is one explicit topic-summary block in the
 * cascade-tools entrypoint; this test pins it so future drift fails CI.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const BIN = resolve(REPO_ROOT, 'bin/cascade-tools.js');
const DIST = resolve(REPO_ROOT, 'dist/cli/bootstrap.js');

function runHelp(args: string[]): { stdout: string; stderr: string; code: number | null } {
	// Strip NODE_ENV — vitest sets it to 'test' which trips the integration
	// entrypoint loaded by `bin/cascade-tools.js` and exits 2 with no diagnostic.
	// Unrelated to the help-rendering surface this test covers.
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

describe('cascade-tools --help — topic summaries', () => {
	// The CLI requires the dist build to exist (bin/cascade-tools.js imports
	// from ../dist/cli/bootstrap.js). Skip with a clear message if not built.
	const built = existsSync(DIST);

	it.skipIf(!built)('topic descriptions are explicit, not borrowed from gadgets', () => {
		const { stdout, code } = runHelp(['--help']);
		expect(code).toBe(0);

		// Must NOT borrow gadget descriptions. These are the first-gadget
		// descriptions that prod showed leaking into topic lines.
		expect(stdout).not.toMatch(
			/pm\s+(?:Add a checklist|Read a work item|Post a comment|Update a work item|Create a new work item|List all work items|Move a work item)/,
		);
		expect(stdout).not.toMatch(/scm\s+Create a GitHub pull request\./);
		expect(stdout).not.toMatch(/alerting\s+Retrieve full details for an alerting event/);
		expect(stdout).not.toMatch(/session\s+Call this gadget when you have completed all tasks/);

		// Must contain canonical topic summaries for every discovered topic.
		expect(stdout).toContain('TOPICS');
		expect(stdout).toMatch(/pm\s+Read and write PM work items/i);
		expect(stdout).toMatch(/scm\s+Interact with GitHub PRs/i);
		expect(stdout).toMatch(/alerting\s+Inspect Sentry alerting/i);
		expect(stdout).toMatch(/session\s+End the agent session/i);
	});

	it.skipIf(!built)('per-gadget --help is unaffected (topic-summary fix is additive)', () => {
		const { stdout, code } = runHelp(['pm', 'read-work-item', '--help']);
		expect(code).toBe(0);
		// Spot-check: the gadget's own description / flags are still rendered.
		expect(stdout).toContain('Read a work item');
		expect(stdout).toContain('--workItemId');
		expect(stdout).toContain('--[no-]includeComments');
	});
});

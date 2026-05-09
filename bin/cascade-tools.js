#!/usr/bin/env node

// cascade-tools' stdout is reserved for the JSON envelope agents parse. The
// worker process at `src/backends/llmist/index.ts` sets
// `LLMIST_LOG_FILE=<engineLogPath>` AND `LLMIST_LOG_TEE='true'` so its OWN
// logger tees to both the engine log file AND stdout. Both env vars are in
// the subprocess allowlist (`src/utils/cascadeEnv.ts`) and pass through to
// the bash subprocess that runs cascade-tools — making the cascade-tools
// logger ALSO tee to stdout, polluting the agent's tool-result channel with
// DEBUG/INFO + ANSI escapes (62% of cascade-tools calls in the 2026-05-09
// prod corpus). Strip the inherited tee BEFORE the singleton logger is
// constructed by the bootstrap import below. With LLMIST_LOG_FILE still set,
// every log line — including the load-bearing `[image-pipeline]
// work-item-fetch summary` per spec 016 — lands in the engine log the worker
// collects, so operator observability via `cascade runs logs <runId>` is
// preserved.
delete process.env.LLMIST_LOG_TEE;
// Standalone CLI runs (no LLMIST_LOG_FILE inherited): redirect to /dev/null
// so dev runs stay envelope-only too. Override for debugging:
// `LLMIST_LOG_FILE=/tmp/x.log cascade-tools ...`.
if (!process.env.LLMIST_LOG_FILE) {
	process.env.LLMIST_LOG_FILE = '/dev/null';
}

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config, run } from '@oclif/core';

// Bootstrap all integrations before oclif loads any command. The CLI
// runs commands lazily, and Spec 006/5 removed the legacy self-bootstrap
// path, so side-effect imports have to fire at the entry point.
// Without this, `cascade-tools pm <cmd>` throws `Unknown PM integration type`.
await import('../dist/cli/bootstrap.js');

// cascade-tools uses its own oclif config independent of package.json,
// which now points to the dashboard CLI (cascade binary).
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const pjson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));

pjson.oclif = {
	bin: 'cascade-tools',
	commands: {
		strategy: 'pattern',
		target: './dist/cli',
		globPatterns: ['**/*.js', '!**/dashboard/**', '!**/_shared/**', '!base.js', '!bootstrap.js'],
	},
	topicSeparator: ' ',
	// Explicit topic summaries. Without this block oclif borrows each topic's
	// description from its FIRST command (see node_modules/@oclif/core
	// /lib/config/config.js — the line `this._topics.set(name, { description:
	// c.summary || c.description, name })`). That made bare `cascade-tools
	// --help` show "pm  Add a checklist with items to a work item..." — a
	// specific gadget's description leaking into the topic line. Agents reading
	// bare --help to map the surface got a misleading frame (saw in 2026-05-09
	// prod corpus). One truthful sentence per topic.
	topics: {
		pm: {
			description:
				'Read and write PM work items, comments, and checklists across Trello/JIRA/Linear.',
		},
		scm: {
			description: 'Interact with GitHub PRs: create, review, comment, fetch diffs and CI logs.',
		},
		alerting: { description: 'Inspect Sentry alerting issues and events.' },
		session: { description: 'End the agent session. Exclusive terminal call.' },
	},
};

const config = await Config.load({ root, pjson });
try {
	await run(process.argv.slice(2), config);
} catch (err) {
	// oclif's `this.exit(code)` throws an ExitError. We've already emitted the
	// cascade-tools error envelope (stdout JSON + stderr prose) at that point;
	// propagating the ExitError to Node's default handler would spew a stack
	// trace that obscures our readable prose. Swallow ExitError quietly and
	// let the exit code stand. Anything else still propagates.
	const code =
		typeof err?.oclif?.exit === 'number' ? err.oclif.exit : err?.code === 'EEXIT' ? 1 : undefined;
	if (code !== undefined) {
		process.exit(code);
	}
	throw err;
}

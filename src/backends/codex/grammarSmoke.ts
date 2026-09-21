import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildArgs } from './index.js';
import { DEFAULT_CODEX_MODEL } from './models.js';
import { CODEX_COMPLETION_OUTPUT_SCHEMA } from './outputSchema.js';
import type { ResolvedCodexSettings } from './settings.js';

/**
 * Model-free check that the pinned Codex CLI parses the exact argv CASCADE generates.
 *
 * A continuation turn is the superset invocation (every option plus the `resume`
 * subcommand), so it is probed with a nil thread id: a compatible CLI accepts the
 * argv and fails only at thread lookup, before any network or model access.
 */

/** Syntactically valid thread id that no rollout can match. */
export const GRAMMAR_PROBE_THREAD_ID = '00000000-0000-0000-0000-000000000000';

/** clap's exit code for usage errors such as "unexpected argument". */
const CLAP_USAGE_ERROR_EXIT_CODE = 2;
const CLAP_USAGE_ERROR_RE = /unexpected argument|^Usage:/m;
const THREAD_LOOKUP_FAILURE_RE = /no rollout found/;

/** Exercises every optional flag `buildArgs` can emit. */
const PROBE_SETTINGS: ResolvedCodexSettings = {
	approvalPolicy: 'never',
	sandboxMode: 'danger-full-access',
	reasoningEffort: 'high',
	webSearch: true,
};

export type GrammarProbeOutcome = { exitCode: number | null; stderr: string };
export type GrammarProbeVerdict = { ok: true } | { ok: false; reason: string };

function firstLine(text: string): string {
	return text.trim().split('\n')[0] ?? '';
}

export function classifyCodexGrammarProbe(outcome: GrammarProbeOutcome): GrammarProbeVerdict {
	if (outcome.exitCode === CLAP_USAGE_ERROR_EXIT_CODE || CLAP_USAGE_ERROR_RE.test(outcome.stderr)) {
		return { ok: false, reason: `codex rejected the generated argv: ${firstLine(outcome.stderr)}` };
	}
	if (!THREAD_LOOKUP_FAILURE_RE.test(outcome.stderr)) {
		return {
			ok: false,
			reason:
				'expected codex to stop at thread lookup ("no rollout found") but it exited ' +
				`${outcome.exitCode ?? 'by signal'}: ${firstLine(outcome.stderr) || '(no stderr)'}`,
		};
	}
	return { ok: true };
}

export async function runCodexGrammarProbe(codexBin = 'codex'): Promise<GrammarProbeOutcome> {
	const probeDir = realpathSync(mkdtempSync(join(tmpdir(), 'cascade-codex-grammar-probe-')));
	const repoDir = join(probeDir, 'repo');
	const codexHome = join(probeDir, 'codex-home');
	mkdirSync(repoDir);
	mkdirSync(codexHome);
	const outputSchemaPath = join(probeDir, 'output-schema.json');
	writeFileSync(outputSchemaPath, JSON.stringify(CODEX_COMPLETION_OUTPUT_SCHEMA));

	const args = buildArgs(
		{ repoDir, blockGitPush: true },
		PROBE_SETTINGS,
		DEFAULT_CODEX_MODEL,
		join(probeDir, 'last-message.txt'),
		outputSchemaPath,
		GRAMMAR_PROBE_THREAD_ID,
	);

	try {
		return await new Promise<GrammarProbeOutcome>((resolve, reject) => {
			const child = spawn(codexBin, args, {
				cwd: repoDir,
				env: {
					PATH: process.env.PATH,
					HOME: probeDir,
					CODEX_HOME: codexHome,
					CODEX_API_KEY: 'grammar-probe',
				},
				stdio: ['pipe', 'ignore', 'pipe'],
			});
			let stderr = '';
			child.stderr.on('data', (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			child.on('error', reject);
			child.on('close', (exitCode) => resolve({ exitCode, stderr }));
			child.stdin.end('grammar probe\n');
		});
	} finally {
		rmSync(probeDir, { recursive: true, force: true });
	}
}

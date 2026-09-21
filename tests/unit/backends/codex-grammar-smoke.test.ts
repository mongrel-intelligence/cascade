import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
	classifyCodexGrammarProbe,
	GRAMMAR_PROBE_THREAD_ID,
	runCodexGrammarProbe,
} from '../../../src/backends/codex/grammarSmoke.js';

const THREAD_LOOKUP_STDERR =
	'Error: thread/resume: thread/resume failed: no rollout found for thread id ' +
	`${GRAMMAR_PROBE_THREAD_ID} (code -32600)\n`;

describe('classifyCodexGrammarProbe', () => {
	it('passes when the CLI accepts the argv and stops only at thread lookup', () => {
		expect(classifyCodexGrammarProbe({ exitCode: 1, stderr: THREAD_LOOKUP_STDERR })).toEqual({
			ok: true,
		});
	});

	it('fails on a clap usage error', () => {
		const verdict = classifyCodexGrammarProbe({
			exitCode: 2,
			stderr:
				"error: unexpected argument '-C' found\n\n  tip: to pass '-C' as a value, use '-- -C'\n\n" +
				'Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]\n',
		});
		expect(verdict).toMatchObject({
			ok: false,
			reason: expect.stringContaining("unexpected argument '-C' found"),
		});
	});

	it('fails closed when the CLI stops anywhere other than thread lookup', () => {
		expect(
			classifyCodexGrammarProbe({
				exitCode: 1,
				stderr: 'Failed to read output schema file /tmp/x.json: No such file or directory\n',
			}),
		).toMatchObject({ ok: false, reason: expect.stringContaining('output schema') });
		expect(classifyCodexGrammarProbe({ exitCode: null, stderr: '' })).toMatchObject({
			ok: false,
		});
		expect(classifyCodexGrammarProbe({ exitCode: 0, stderr: '' })).toMatchObject({ ok: false });
	});
});

describe('runCodexGrammarProbe', () => {
	let fakeBinDir: string;

	afterEach(() => {
		rmSync(fakeBinDir, { recursive: true, force: true });
	});

	it('runs the generated resume argv against the binary in an isolated CODEX_HOME', async () => {
		fakeBinDir = mkdtempSync(join(tmpdir(), 'cascade-fake-codex-'));
		const argvLog = join(fakeBinDir, 'argv.json');
		const fakeCodex = join(fakeBinDir, 'codex');
		writeFileSync(
			fakeCodex,
			'#!/usr/bin/env node\n' +
				`require('node:fs').writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify({\n` +
				'  argv: process.argv.slice(2), codexHome: process.env.CODEX_HOME, cwd: process.cwd(),\n' +
				'}));\n' +
				`process.stderr.write(${JSON.stringify(THREAD_LOOKUP_STDERR)});\n` +
				'process.exit(1);\n',
			{ mode: 0o755 },
		);

		const outcome = await runCodexGrammarProbe(fakeCodex);

		expect(classifyCodexGrammarProbe(outcome)).toEqual({ ok: true });
		const recorded = JSON.parse(readFileSync(argvLog, 'utf8')) as {
			argv: string[];
			codexHome: string;
			cwd: string;
		};
		expect(recorded.argv[0]).toBe('exec');
		expect(recorded.argv.slice(-3)).toEqual(['resume', GRAMMAR_PROBE_THREAD_ID, '-']);
		// Every optional flag CASCADE can emit is exercised by the probe.
		expect(recorded.argv).toContain('--dangerously-bypass-hook-trust');
		expect(recorded.argv).toContain('web_search="live"');
		expect(recorded.argv).toContain('model_reasoning_effort="high"');
		expect(recorded.argv[recorded.argv.indexOf('-C') + 1]).toBe(recorded.cwd);
		expect(recorded.codexHome).not.toBe(join(homedir(), '.codex'));
	});
});

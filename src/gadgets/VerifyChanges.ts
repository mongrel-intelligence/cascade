/**
 * VerifyChanges gadget - Run diagnostics and/or tests on modified files.
 *
 * Supports three scopes:
 * - diagnostics: Run tsc + Biome across all modified files
 * - tests: Run project test command via .cascade/on-verify.sh
 * - full: Both diagnostics and tests
 *
 * This closes the feedback loop between edits and verification,
 * letting agents self-correct before pushing.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Gadget, z } from 'llmist';

import {
	getFilesWithErrors,
	getModifiedFiles,
	runDiagnosticsWithTracking,
} from './shared/diagnosticState.js';
import { shouldRunDiagnostics } from './shared/diagnostics.js';

type VerifyScope = 'diagnostics' | 'tests' | 'full';

export class VerifyChanges extends Gadget({
	name: 'VerifyChanges',
	description: `Run verification checks on all files modified during this session.

Use after completing a batch of edits to verify correctness before pushing.

Scopes:
- diagnostics: TypeScript type checking + Biome linting on modified files
- tests: Run project test suite via .cascade/on-verify.sh hook
- full: Both diagnostics and tests`,
	timeoutMs: 120000, // Tests can take a while
	maxConcurrent: 1,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		scope: z
			.enum(['diagnostics', 'tests', 'full'])
			.optional()
			.default('full')
			.describe('What to verify: diagnostics, tests, or full (default: full)'),
	}),
	examples: [
		{
			params: {
				comment: 'Verifying all changes before creating PR',
				scope: 'full',
			},
			output: `=== VerifyChanges (scope=full) ===
Modified files: 3

--- Diagnostics ---
✅ All 3 files pass type checking and linting

--- Tests ---
✅ on-verify.sh passed

All checks passed.`,
			comment: 'Full verification with diagnostics and tests passing',
		},
	],
}) {
	override execute(params: this['params']): string {
		const scope = params.scope as VerifyScope;
		const modifiedFiles = getModifiedFiles();

		const output: string[] = [
			`=== VerifyChanges (scope=${scope}) ===`,
			`Modified files: ${modifiedFiles.length}`,
		];

		if (modifiedFiles.length === 0) {
			output.push('', 'No files have been modified in this session.');
			return output.join('\n');
		}

		let hasFailures = false;

		// Run diagnostics
		if (scope === 'diagnostics' || scope === 'full') {
			output.push('', '--- Diagnostics ---');
			const diagnosticOutput = this.runDiagnostics(modifiedFiles);
			output.push(diagnosticOutput.message);
			if (diagnosticOutput.hasErrors) hasFailures = true;
		}

		// Run tests
		if (scope === 'tests' || scope === 'full') {
			output.push('', '--- Tests ---');
			const testOutput = this.runTests(scope);
			output.push(testOutput.message);
			if (testOutput.hasErrors) hasFailures = true;
		}

		output.push(
			'',
			hasFailures ? 'Some checks failed. Review and fix before pushing.' : 'All checks passed.',
		);

		return output.join('\n');
	}

	private runDiagnostics(modifiedFiles: string[]): { message: string; hasErrors: boolean } {
		const tsFiles = modifiedFiles.filter((f) => shouldRunDiagnostics(f));

		if (tsFiles.length === 0) {
			return { message: 'No TypeScript files to check.', hasErrors: false };
		}

		// Run diagnostics on each modified TS file
		for (const filePath of tsFiles) {
			runDiagnosticsWithTracking(filePath, filePath);
		}

		const filesWithErrors = getFilesWithErrors();
		const errorFiles = filesWithErrors.filter((f) => modifiedFiles.includes(f.filePath));

		if (errorFiles.length === 0) {
			return {
				message: `✅ All ${tsFiles.length} TypeScript file(s) pass type checking and linting`,
				hasErrors: false,
			};
		}

		const lines: string[] = [`⚠️ ${errorFiles.length} file(s) with issues:`];

		for (const file of errorFiles) {
			lines.push(`  ${file.filePath}: ${file.errors.length} error(s)`);
			for (const error of file.errors.slice(0, 5)) {
				const lineInfo = error.line ? `:${error.line}` : '';
				lines.push(`    - ${error.type}: ${error.message}${lineInfo}`);
			}
		}

		return { message: lines.join('\n'), hasErrors: true };
	}

	private runTests(scope: VerifyScope): { message: string; hasErrors: boolean } {
		const cwd = process.cwd();
		const hookPath = join(cwd, '.cascade', 'on-verify.sh');

		if (!existsSync(hookPath)) {
			return {
				message:
					'No .cascade/on-verify.sh hook found. Skipping test execution.\nTIP: Create .cascade/on-verify.sh to enable automated test verification.',
				hasErrors: false,
			};
		}

		try {
			const output = execFileSync('bash', [hookPath, scope], {
				cwd,
				timeout: 90000,
				encoding: 'utf-8',
				stdio: 'pipe',
			});

			const trimmed = (output ?? '').trim();
			return {
				message: trimmed ? `✅ on-verify.sh passed\n${trimmed}` : '✅ on-verify.sh passed',
				hasErrors: false,
			};
		} catch (error) {
			const execError = error as {
				status?: number | null;
				stdout?: string;
				stderr?: string;
				message?: string;
			};

			const stdout = execError.stdout?.trim() ?? '';
			const stderr = execError.stderr?.trim() ?? '';
			const combined = [stdout, stderr].filter(Boolean).join('\n');

			return {
				message: `❌ on-verify.sh failed (exit code ${execError.status ?? 'unknown'})\n${combined}`,
				hasErrors: true,
			};
		}
	}
}

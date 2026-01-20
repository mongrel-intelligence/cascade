/**
 * Diagnostics runner for file editing gadgets.
 *
 * Runs TypeScript type checking and Biome linting after file modifications.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Result from running diagnostics.
 */
export interface DiagnosticsResult {
	output: string;
	hasParseErrors: boolean;
	hasTypeErrors: boolean;
	hasLintErrors: boolean;
	/** Raw TypeScript output for error parsing */
	rawTypescript?: string;
	/** Raw Biome output for error parsing */
	rawBiome?: string;
}

/**
 * Find the project root by walking up from a file path looking for tsconfig.json.
 *
 * @param filePath The file path to start searching from
 * @returns The project root directory, or current working directory as fallback
 */
function findProjectRoot(filePath: string): string {
	let dir = dirname(filePath);
	while (dir !== '/') {
		if (existsSync(join(dir, 'tsconfig.json'))) {
			return dir;
		}
		dir = dirname(dir);
	}
	return process.cwd();
}

/**
 * Run TypeScript and Biome diagnostics on a file.
 *
 * @param filePath The file path being checked
 * @returns Diagnostics result with output string and parse error flag
 */
export function runDiagnostics(filePath: string): DiagnosticsResult {
	const sections: string[] = [];
	let hasParseErrors = false;
	let hasTypeErrors = false;
	let hasLintErrors = false;
	let rawTypescript: string | undefined;
	let rawBiome: string | undefined;

	const projectRoot = findProjectRoot(filePath);

	// TypeScript check
	try {
		execSync('npx tsc --noEmit --pretty false', {
			encoding: 'utf-8',
			cwd: projectRoot,
			timeout: 20000,
			stdio: 'pipe',
		});
		sections.push('=== TypeScript Check ===');
		sections.push('No type errors found.');
	} catch (error) {
		const execError = error as { stdout?: string; stderr?: string };
		const output = [execError.stdout, execError.stderr].filter(Boolean).join('\n');
		rawTypescript = output;
		sections.push('=== TypeScript Check ===');
		sections.push(output.trim() || 'No type errors found.');

		// Check if there are TypeScript errors in the edited file specifically
		if (output.includes(filePath)) {
			hasTypeErrors = true;
		}
	}

	// Biome lint and format (auto-fix)
	try {
		const biomeOutput = execSync(`npx biome check --write "${filePath}"`, {
			encoding: 'utf-8',
			cwd: projectRoot,
			timeout: 10000,
			stdio: 'pipe',
		});
		sections.push('');
		sections.push('=== Biome Lint ===');
		const trimmed = biomeOutput.trim();
		sections.push(trimmed || 'No lint issues found.');
	} catch (error) {
		const execError = error as { stdout?: string; stderr?: string };
		// Biome outputs detailed diagnostics to stderr, summary to stdout
		// Show stderr (details) first, then stdout (summary)
		const stderr = execError.stderr?.trim() || '';
		const stdout = execError.stdout?.trim() || '';
		const output = [stderr, stdout].filter(Boolean).join('\n\n');
		rawBiome = output;
		sections.push('');
		sections.push('=== Biome Lint ===');
		sections.push(output || 'No lint issues found.');

		// Detect parse errors from Biome output
		if (stderr.includes(' parse ') || stdout.includes(' parse ')) {
			hasParseErrors = true;
		}

		// Detect lint errors (Biome error exit but not parse errors)
		// Check if output mentions the file being edited (relevant lint errors)
		if (output.includes(filePath) && !hasParseErrors) {
			hasLintErrors = true;
		}
	}

	return {
		output: sections.join('\n'),
		hasParseErrors,
		hasTypeErrors,
		hasLintErrors,
		rawTypescript,
		rawBiome,
	};
}

/**
 * Check if a file should have diagnostics run.
 *
 * @param filePath The file path to check
 * @returns True if the file is a TypeScript file
 */
export function shouldRunDiagnostics(filePath: string): boolean {
	return filePath.endsWith('.ts') || filePath.endsWith('.tsx');
}

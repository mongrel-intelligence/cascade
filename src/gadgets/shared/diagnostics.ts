/**
 * Diagnostics runner for file editing gadgets.
 *
 * Runs TypeScript type checking and Biome linting after file modifications.
 */

import { execSync } from 'node:child_process';

/**
 * Run TypeScript and Biome diagnostics on a file.
 *
 * @param filePath The file path being checked (for filtering errors)
 * @returns Formatted diagnostics output string
 */
export function runDiagnostics(filePath: string): string {
	const sections: string[] = [];

	// TypeScript check
	try {
		execSync('npx tsc --noEmit --pretty false', {
			encoding: 'utf-8',
			cwd: process.cwd(),
			timeout: 20000,
			stdio: 'pipe',
		});
		sections.push('=== TypeScript Check ===');
		sections.push('No type errors found.');
	} catch (error) {
		const execError = error as { stdout?: string; stderr?: string };
		const output = [execError.stdout, execError.stderr].filter(Boolean).join('\n');
		// Filter to errors in the edited file, but keep full error messages
		const lines = output.split('\n');
		const fileErrors: string[] = [];
		let includeNext = false;
		for (const line of lines) {
			if (line.includes(filePath)) {
				fileErrors.push(line);
				includeNext = true;
			} else if (includeNext && (line.startsWith(' ') || line === '')) {
				fileErrors.push(line);
			} else {
				includeNext = false;
			}
		}
		sections.push('=== TypeScript Check ===');
		sections.push(fileErrors.join('\n') || 'No type errors found.');
	}

	// Biome lint check
	try {
		execSync(`npx biome check "${filePath}"`, {
			encoding: 'utf-8',
			cwd: process.cwd(),
			timeout: 10000,
			stdio: 'pipe',
		});
		sections.push('');
		sections.push('=== Biome Lint ===');
		sections.push('No lint issues found.');
	} catch (error) {
		const execError = error as { stdout?: string; stderr?: string };
		// Biome outputs diagnostics to stdout, summary to stderr - capture both
		const output = [execError.stdout, execError.stderr].filter(Boolean).join('\n');
		sections.push('');
		sections.push('=== Biome Lint ===');
		sections.push(output.trim() || 'No lint issues found.');
	}

	return sections.join('\n');
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

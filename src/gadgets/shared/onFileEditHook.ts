/**
 * On-file-edit hook runner for repository-specific post-edit checks.
 *
 * Repositories can define `.cascade/on-file-edit.sh` to run custom
 * linters, type checkers, or formatters after any file edit by an agent.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface OnFileEditHookResult {
	exitCode: number;
	output: string;
}

/** Cached hook existence: true = exists, false = doesn't, undefined = not checked */
let hookExistsCache: boolean | undefined;

/**
 * Clear the hook existence cache (call at session reset).
 */
export function clearOnFileEditHookCache(): void {
	hookExistsCache = undefined;
}

/**
 * Run the `.cascade/on-file-edit.sh` hook if it exists in the target repo root.
 *
 * @param filePath The file that was edited (passed as $1 to the hook)
 * @returns Hook result, or null if the hook doesn't exist
 */
export function runOnFileEditHook(filePath: string): OnFileEditHookResult | null {
	const cwd = process.cwd();
	const hookPath = join(cwd, '.cascade', 'on-file-edit.sh');

	// Check existence with caching
	if (hookExistsCache === undefined) {
		hookExistsCache = existsSync(hookPath);
	}

	if (!hookExistsCache) {
		return null;
	}

	try {
		const output = execFileSync('bash', [hookPath, filePath], {
			cwd,
			timeout: 30000,
			encoding: 'utf-8',
			stdio: 'pipe',
		});

		return { exitCode: 0, output: output ?? '' };
	} catch (error) {
		const execError = error as {
			status?: number | null;
			stdout?: string;
			stderr?: string;
			message?: string;
		};

		// exec error with exit code (hook ran but returned non-zero)
		if (execError.status != null) {
			const stdout = execError.stdout ?? '';
			const stderr = execError.stderr ?? '';
			return {
				exitCode: execError.status,
				output: [stdout, stderr].filter(Boolean).join('\n'),
			};
		}

		// Spawn/timeout error
		return {
			exitCode: 1,
			output: execError.message ?? 'Unknown error running on-file-edit hook',
		};
	}
}

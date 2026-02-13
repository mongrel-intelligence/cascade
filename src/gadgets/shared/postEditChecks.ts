/**
 * Unified post-edit checks dispatcher.
 *
 * Routes to either the repo's `.cascade/on-file-edit.sh` hook (if present)
 * or the built-in tsc + Biome diagnostics.
 */

import type { DiagnosticCheckResult } from './diagnosticState.js';
import { runDiagnosticsWithTracking, trackModifiedFile } from './diagnosticState.js';
import { runOnFileEditHook } from './onFileEditHook.js';

/**
 * Run post-edit checks on a file.
 *
 * If `.cascade/on-file-edit.sh` exists, it replaces the built-in diagnostics.
 * Otherwise, falls back to tsc + Biome via `runDiagnosticsWithTracking`.
 *
 * @param filePath The file path (relative, as displayed to user)
 * @param validatedPath The validated/resolved path for running checks
 * @returns Check result with hasErrors and statusMessage, or null if no checks apply
 */
export function runPostEditChecks(
	filePath: string,
	validatedPath: string,
): DiagnosticCheckResult | null {
	// Track every file that gets post-edit checks (i.e., every edited file)
	trackModifiedFile(filePath);

	const hookResult = runOnFileEditHook(filePath);

	if (hookResult) {
		const hasErrors = hookResult.exitCode !== 0;
		const output = hookResult.output.trim();
		const statusMessage = output
			? `=== on-file-edit ===\n${output}`
			: hasErrors
				? '=== on-file-edit ===\n⚠️ Hook exited with errors'
				: '=== on-file-edit ===\n✓ No issues';

		return {
			hasErrors,
			statusMessage,
			fullResult: {
				output: hookResult.output,
				hasParseErrors: false,
				hasTypeErrors: hasErrors,
				hasLintErrors: false,
			},
		};
	}

	return runDiagnosticsWithTracking(filePath, validatedPath);
}

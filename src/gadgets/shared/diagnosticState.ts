/**
 * Diagnostic state tracker for file editing gadgets.
 *
 * Tracks TypeScript/Biome diagnostic results across file edits,
 * allowing the trailing message to display consolidated diagnostic status.
 */

import { runDiagnostics as runDiagnosticsCore, shouldRunDiagnostics } from './diagnostics.js';
import type { DiagnosticsResult } from './diagnostics.js';

/**
 * Individual diagnostic error.
 */
export interface DiagnosticError {
	type: 'typescript' | 'biome-parse' | 'biome-lint';
	code?: string;
	message: string;
	line?: number;
}

/**
 * Status of a single file's diagnostics.
 */
export interface FileStatus {
	filePath: string;
	hasTypeErrors: boolean;
	hasParseErrors: boolean;
	hasLintErrors: boolean;
	errors: DiagnosticError[];
	lastChecked: Date;
}

/**
 * Parse TypeScript errors from tsc output.
 *
 * TypeScript output format: `file.ts(line,col): error TS1234: message`
 */
function parseTypeScriptErrors(output: string, filePath: string): DiagnosticError[] {
	const errors: DiagnosticError[] = [];
	const lines = output.split('\n');

	// Match lines containing the file path with error format
	for (const line of lines) {
		if (!line.includes(filePath)) continue;

		// Parse: file.ts(line,col): error TS1234: message
		const match = line.match(/\((\d+),\d+\):\s*error\s+(TS\d+):\s*(.+)/);
		if (match) {
			errors.push({
				type: 'typescript',
				line: Number.parseInt(match[1], 10),
				code: match[2],
				message: match[3].trim(),
			});
		}
	}

	return errors;
}

/**
 * Parse Biome errors from biome output.
 *
 * Biome output format includes both parse errors and lint errors.
 * Parse errors contain "parse" keyword, lint errors have rule names like "lint/xxx".
 */
function parseBiomeParseErrors(output: string, filePath: string): DiagnosticError[] {
	if (!output.includes(filePath)) return [];

	const lineMatch = output.match(new RegExp(`${escapeRegExp(filePath)}:(\\d+):\\d+`));
	return [
		{
			type: 'biome-parse',
			line: lineMatch ? Number.parseInt(lineMatch[1], 10) : undefined,
			message: 'parse error',
		},
	];
}

function parseBiomeLintErrors(output: string, filePath: string): DiagnosticError[] {
	if (!output.includes(filePath)) return [];

	const errors: DiagnosticError[] = [];
	const lintRuleMatches = output.matchAll(/lint\/\w+\/(\w+)/g);
	const seenRules = new Set<string>();

	for (const match of lintRuleMatches) {
		const ruleName = match[1];
		if (seenRules.has(ruleName)) continue;
		seenRules.add(ruleName);

		const lineMatch = output.match(new RegExp(`${escapeRegExp(filePath)}:(\\d+):\\d+`));
		errors.push({
			type: 'biome-lint',
			code: ruleName,
			line: lineMatch ? Number.parseInt(lineMatch[1], 10) : undefined,
			message: `lint: ${ruleName}`,
		});
	}

	if (errors.length === 0) {
		errors.push({ type: 'biome-lint', message: 'lint error(s) detected' });
	}

	return errors;
}

function parseBiomeErrors(
	output: string,
	filePath: string,
	hasParseErrors: boolean,
	hasLintErrors: boolean,
): DiagnosticError[] {
	const errors: DiagnosticError[] = [];
	if (hasParseErrors) errors.push(...parseBiomeParseErrors(output, filePath));
	if (hasLintErrors) errors.push(...parseBiomeLintErrors(output, filePath));
	return errors;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Track files with diagnostic issues (session-scoped)
const fileStatuses = new Map<string, FileStatus>();

// Track all modified files during the session (for VerifyChanges)
const modifiedFiles = new Set<string>();

// Track consecutive edit failures per file (for escalation hints)
const editFailureCounts = new Map<string, number>();

/**
 * Mark a file as modified during this session.
 */
export function trackModifiedFile(filePath: string): void {
	modifiedFiles.add(filePath);
}

/**
 * Get all files modified during this session.
 */
export function getModifiedFiles(): string[] {
	return Array.from(modifiedFiles).sort();
}

/**
 * Clear modified file tracking.
 */
export function clearModifiedFiles(): void {
	modifiedFiles.clear();
}

/**
 * Update diagnostic state for a file.
 *
 * @param filePath The file path (relative or absolute)
 * @param result The diagnostics result from running checks
 * @param rawOutput Optional raw diagnostic output for parsing individual errors
 */
export function updateDiagnosticState(
	filePath: string,
	result: DiagnosticsResult,
	rawOutput?: { typescript?: string; biome?: string },
): void {
	const errors: DiagnosticError[] = [];

	// Parse errors from raw output if available
	if (rawOutput?.typescript) {
		errors.push(...parseTypeScriptErrors(rawOutput.typescript, filePath));
	}
	if (rawOutput?.biome) {
		errors.push(
			...parseBiomeErrors(rawOutput.biome, filePath, result.hasParseErrors, result.hasLintErrors),
		);
	}

	// If no errors were parsed but we have error flags, add generic entries
	if (result.hasTypeErrors && !errors.some((e) => e.type === 'typescript')) {
		errors.push({
			type: 'typescript',
			message: 'Type errors detected (see full diagnostics)',
		});
	}
	if (result.hasParseErrors && !errors.some((e) => e.type === 'biome-parse')) {
		errors.push({
			type: 'biome-parse',
			message: 'Parse error detected (see full diagnostics)',
		});
	}
	if (result.hasLintErrors && !errors.some((e) => e.type === 'biome-lint')) {
		errors.push({
			type: 'biome-lint',
			message: 'Lint error(s) detected (see full diagnostics)',
		});
	}

	// Update or clear the file status
	if (result.hasTypeErrors || result.hasParseErrors || result.hasLintErrors) {
		fileStatuses.set(filePath, {
			filePath,
			hasTypeErrors: result.hasTypeErrors,
			hasParseErrors: result.hasParseErrors,
			hasLintErrors: result.hasLintErrors,
			errors,
			lastChecked: new Date(),
		});
	} else {
		// File is clean - remove from tracking
		fileStatuses.delete(filePath);
	}
}

/**
 * Get all files with diagnostic errors.
 *
 * @returns Array of file statuses with errors
 */
export function getFilesWithErrors(): FileStatus[] {
	return Array.from(fileStatuses.values()).sort((a, b) => a.filePath.localeCompare(b.filePath));
}

/**
 * Check if there are any files with diagnostic errors.
 */
export function hasAnyDiagnosticErrors(): boolean {
	return fileStatuses.size > 0;
}

/**
 * Record an edit failure for a file and return the new failure count.
 */
export function recordEditFailure(filePath: string): number {
	const count = (editFailureCounts.get(filePath) ?? 0) + 1;
	editFailureCounts.set(filePath, count);
	return count;
}

/**
 * Clear the edit failure counter for a file (call after successful edit).
 */
export function clearEditFailure(filePath: string): void {
	editFailureCounts.delete(filePath);
}

/**
 * Clear all edit failure counters.
 */
export function clearEditFailures(): void {
	editFailureCounts.clear();
}

/**
 * Clear all diagnostic state (call at session start).
 */
export function clearDiagnosticState(): void {
	fileStatuses.clear();
	modifiedFiles.clear();
	editFailureCounts.clear();
}

/**
 * Format diagnostic status for display in trailing message.
 *
 * @returns Formatted markdown string showing diagnostic status
 */
export function formatDiagnosticStatus(): string {
	const filesWithErrors = getFilesWithErrors();

	if (filesWithErrors.length === 0) {
		return '## Diagnostic Status [v2]\n\n✅ All edited files pass type checking';
	}

	const lines: string[] = [
		'## Diagnostic Status [v2]',
		'',
		`⚠️ ${filesWithErrors.length} file(s) with issues:`,
	];

	for (const file of filesWithErrors) {
		const errorCount = file.errors.length;
		lines.push('', `**${file.filePath}** (${errorCount} error${errorCount !== 1 ? 's' : ''})`);

		for (const error of file.errors) {
			const lineInfo = error.line ? ` (line ${error.line})` : '';
			const codeInfo = error.code ? `${error.code}: ` : '';
			let prefix: string;
			switch (error.type) {
				case 'typescript':
					prefix = 'TS';
					break;
				case 'biome-parse':
					prefix = 'Parse';
					break;
				case 'biome-lint':
					prefix = 'Lint';
					break;
			}
			lines.push(`- ${prefix}: ${codeInfo}${error.message}${lineInfo}`);
		}
	}

	return lines.join('\n');
}

/**
 * Result from running diagnostics with state tracking.
 */
export interface DiagnosticCheckResult {
	/** Whether the file has errors */
	hasErrors: boolean;
	/** Simplified status message for gadget output */
	statusMessage: string;
	/** Full diagnostic result (for cases where full output is needed) */
	fullResult: DiagnosticsResult;
}

/**
 * Run diagnostics on a file and update the state tracker.
 *
 * This is the main entry point for gadgets to run diagnostics.
 * It runs the checks, updates the state tracker, and returns a simplified status.
 *
 * @param filePath The file path (relative, as displayed to user)
 * @param validatedPath The validated/resolved path for running checks
 * @returns Diagnostic check result with simplified status
 */
export function runDiagnosticsWithTracking(
	filePath: string,
	validatedPath: string,
): DiagnosticCheckResult | null {
	if (!shouldRunDiagnostics(filePath)) {
		return null;
	}

	const result = runDiagnosticsCore(validatedPath);

	// Update state tracker with raw output for error parsing
	updateDiagnosticState(filePath, result, {
		typescript: result.rawTypescript,
		biome: result.rawBiome,
	});

	const hasErrors = result.hasParseErrors || result.hasTypeErrors || result.hasLintErrors;

	// Generate simplified status message
	let statusMessage: string;
	if (hasErrors) {
		const tsErrorCount = result.rawTypescript?.match(/error TS\d+/g)?.length ?? 0;
		const parseErrorCount = result.hasParseErrors ? 1 : 0;
		const lintErrorCount = result.hasLintErrors ? 1 : 0;
		const errorCount = tsErrorCount + parseErrorCount + lintErrorCount;
		statusMessage = `⚠️ ${errorCount || 'Some'} diagnostic issue(s) - see trailing message for details`;
	} else {
		statusMessage = '✓ No issues';
	}

	return {
		hasErrors,
		statusMessage,
		fullResult: result,
	};
}

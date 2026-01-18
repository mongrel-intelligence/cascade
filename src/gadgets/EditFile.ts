/**
 * EditFile gadget - Edit files using search/replace with layered matching.
 *
 * Uses layered matching strategies: exact → whitespace → indentation → fuzzy
 * This approach reduces edit errors by ~9x (per Aider benchmarks).
 */

import { execSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { Gadget, z } from 'llmist';

import { applyReplacement, findAllMatches, getMatchFailure } from './editfile/matcher.js';
import { invalidateFileRead } from './readTracking.js';

const ALLOWED_PATHS = ['/tmp'];

function validatePath(inputPath: string): string {
	const cwd = process.cwd();
	const resolvedPath = resolve(cwd, inputPath);

	let finalPath: string;
	try {
		finalPath = realpathSync(resolvedPath);
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code === 'ENOENT') {
			finalPath = resolvedPath;
		} else {
			throw error;
		}
	}

	// Check if within CWD
	const cwdWithSep = cwd + sep;
	if (finalPath.startsWith(cwdWithSep) || finalPath === cwd) {
		return finalPath;
	}

	// Check if within allowed paths
	for (const allowedPath of ALLOWED_PATHS) {
		const allowedWithSep = allowedPath + sep;
		if (finalPath.startsWith(allowedWithSep) || finalPath === allowedPath) {
			return finalPath;
		}
	}

	throw new Error(
		`Path access denied: ${inputPath}. Path must be within working directory or allowed paths (${ALLOWED_PATHS.join(', ')})`,
	);
}

export class EditFile extends Gadget({
	name: 'EditFile',
	description: `Edit a file by searching for content and replacing it.

For multiple edits to the same file, call this gadget multiple times.
Each call provides immediate feedback, allowing you to adjust subsequent edits.`,
	timeoutMs: 30000,
	maxConcurrent: 1, // Sequential execution to prevent race conditions on file writes
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		filePath: z.string().describe('Path to the file to edit (relative or absolute)'),
		search: z.string().describe('The content to search for in the file'),
		replace: z.string().describe('The content to replace it with (empty string to delete)'),
	}),
	examples: [
		{
			params: {
				comment: 'Increasing timeout from 1s to 5s to fix test flakiness',
				filePath: 'src/config.ts',
				search: 'timeout: 1000',
				replace: 'timeout: 5000',
			},
			output: `path=src/config.ts status=success matches=1 strategy=exact

Replaced 1 occurrence.

=== Edit 1 (lines 5-5) ===
--- BEFORE ---
   1 | import { foo } from "bar";
   2 |
   3 | const CONFIG = {
   4 |   debug: false,
>  5 |   timeout: 1000,
   6 |   retries: 3,
   7 | };

--- AFTER ---
   1 | import { foo } from "bar";
   2 |
   3 | const CONFIG = {
   4 |   debug: false,
>  5 |   timeout: 5000,
   6 |   retries: 3,
   7 | };

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Single edit with before/after context and diagnostics',
		},
		{
			params: {
				comment: 'Updating retry constant per requirements',
				filePath: 'src/constants.ts',
				search: 'MAX_RETRIES = 3',
				replace: 'MAX_RETRIES = 5',
			},
			output: `path=src/constants.ts status=success matches=2 strategy=exact

Replaced 2 occurrences.

=== Edit 1 (lines 4-4) ===
--- BEFORE ---
   1 | // API constants
   2 | export const API_URL = "https://api.example.com";
   3 |
>  4 | export const MAX_RETRIES = 3;
   5 | export const TIMEOUT = 5000;

--- AFTER ---
   1 | // API constants
   2 | export const API_URL = "https://api.example.com";
   3 |
>  4 | export const MAX_RETRIES = 5;
   5 | export const TIMEOUT = 5000;

=== Edit 2 (lines 12-12) ===
--- BEFORE ---
   9 | // Client constants
  10 | export const CLIENT_URL = "https://client.example.com";
  11 |
> 12 | export const MAX_RETRIES = 3;
  13 | export const CLIENT_TIMEOUT = 3000;

--- AFTER ---
   9 | // Client constants
  10 | export const CLIENT_URL = "https://client.example.com";
  11 |
> 12 | export const MAX_RETRIES = 5;
  13 | export const CLIENT_TIMEOUT = 3000;

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Multiple matches replaced with before/after for each',
		},
		{
			params: {
				comment: 'Enabling feature flag for new functionality',
				filePath: 'src/data.json',
				search: '"enabled": false',
				replace: '"enabled": true',
			},
			output: `path=src/data.json status=success matches=1 strategy=exact

Replaced 1 occurrence.

=== Edit 1 (lines 3-3) ===
--- BEFORE ---
   1 | {
   2 |   "name": "example",
>  3 |   "enabled": false,
   4 |   "count": 0
   5 | }

--- AFTER ---
   1 | {
   2 |   "name": "example",
>  3 |   "enabled": true,
   4 |   "count": 0
   5 | }`,
			comment: 'Non-TypeScript file (no diagnostics appended)',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { filePath, search, replace } = params;

		// Validate search is not empty
		if (search.trim() === '') {
			return `path=${filePath} status=error\n\nError: Search content cannot be empty.`;
		}

		// Validate and resolve path
		let validatedPath: string;
		try {
			validatedPath = validatePath(filePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return `path=${filePath} status=error\n\nError: ${message}`;
		}

		// Read file content
		let content: string;
		try {
			content = readFileSync(validatedPath, 'utf-8');
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === 'ENOENT') {
				throw new Error(`File not found: ${filePath}`);
			}
			throw error;
		}

		// Find ALL matches using layered strategies
		const matches = findAllMatches(content, search);

		if (matches.length === 0) {
			// No match found - throw with helpful suggestions
			const failure = getMatchFailure(content, search);
			throw new Error(this.formatFailure(filePath, search, failure, content));
		}

		// Store original content for before/after display
		const originalLines = content.split('\n');

		// Collect before contexts BEFORE applying any replacements
		const beforeContexts: Array<{
			startLine: number;
			endLine: number;
			context: string;
		}> = [];
		for (const match of matches) {
			beforeContexts.push({
				startLine: match.startLine,
				endLine: match.endLine,
				context: this.formatContext(originalLines, match.startLine, match.endLine, 5),
			});
		}

		// Apply replacements in reverse order (to preserve indices)
		let newContent = content;
		const sortedMatches = [...matches].sort((a, b) => b.startIndex - a.startIndex);
		for (const match of sortedMatches) {
			newContent = applyReplacement(newContent, match, replace);
		}

		// Write file
		try {
			writeFileSync(validatedPath, newContent, 'utf-8');
			// Invalidate read tracking so subsequent reads return fresh content
			invalidateFileRead(validatedPath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return `path=${filePath} status=error\n\nError writing file: ${message}`;
		}

		// Build and return success output
		return this.buildSuccessOutput(
			filePath,
			validatedPath,
			matches,
			beforeContexts,
			replace,
			newContent,
		);
	}

	private buildSuccessOutput(
		filePath: string,
		validatedPath: string,
		matches: Array<{
			startLine: number;
			endLine: number;
			strategy: string;
		}>,
		beforeContexts: Array<{
			startLine: number;
			endLine: number;
			context: string;
		}>,
		replace: string,
		newContent: string,
	): string {
		const newLines = newContent.split('\n');
		const output: string[] = [
			`path=${filePath} status=success matches=${matches.length} strategy=${matches[0].strategy}`,
			'',
			`Replaced ${matches.length} occurrence${matches.length > 1 ? 's' : ''}.`,
		];

		const replacementLineCount = replace.split('\n').length;
		let cumulativeLineDelta = 0;

		for (let i = 0; i < matches.length; i++) {
			const match = matches[i];
			const matchedLineCount = match.endLine - match.startLine + 1;
			const lineDelta = replacementLineCount - matchedLineCount;
			const afterStartLine = match.startLine + cumulativeLineDelta;
			const afterEndLine = afterStartLine + replacementLineCount - 1;

			output.push(
				'',
				`=== Edit ${i + 1} (lines ${match.startLine}-${match.endLine}) ===`,
				'--- BEFORE ---',
				beforeContexts[i].context,
				'',
				'--- AFTER ---',
				this.formatContext(newLines, afterStartLine, afterEndLine, 5),
			);

			cumulativeLineDelta += lineDelta;
		}

		if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
			output.push('', this.runDiagnostics(validatedPath));
		}

		return output.join('\n');
	}

	private formatFailure(
		filePath: string,
		search: string,
		failure: {
			reason: string;
			suggestions: Array<{
				content: string;
				lineNumber: number;
				similarity: number;
			}>;
			nearbyContext: string;
		},
		fileContent: string,
	): string {
		const lines: string[] = [
			`path=${filePath} status=failed`,
			'',
			`Error: ${failure.reason}`,
			'',
			'SEARCH CONTENT:',
			'```',
			search,
			'```',
		];

		if (failure.suggestions.length > 0) {
			lines.push('', 'SUGGESTIONS (similar content found):');
			for (const suggestion of failure.suggestions) {
				const percent = Math.round(suggestion.similarity * 100);
				lines.push(
					'',
					`Line ${suggestion.lineNumber} (${percent}% similar):`,
					'```',
					suggestion.content,
					'```',
				);
			}

			if (failure.nearbyContext) {
				lines.push('', 'CONTEXT:', failure.nearbyContext);
			}
		}

		lines.push('', 'CURRENT FILE CONTENT:', '```', fileContent, '```');

		return lines.join('\n');
	}

	private formatContext(
		lines: string[],
		startLine: number,
		endLine: number,
		contextLines = 5,
	): string {
		const rangeStart = Math.max(0, startLine - 1 - contextLines);
		const rangeEnd = Math.min(lines.length, endLine + contextLines);

		const result: string[] = [];
		for (let i = rangeStart; i < rangeEnd; i++) {
			const lineNum = i + 1;
			const isEdited = lineNum >= startLine && lineNum <= endLine;
			const marker = isEdited ? '>' : ' ';
			const paddedNum = String(lineNum).padStart(4);
			result.push(`${marker}${paddedNum} | ${lines[i]}`);
		}

		return result.join('\n');
	}

	private runDiagnostics(filePath: string): string {
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
}

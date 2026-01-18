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
	description: `Edit a file using one of three modes:

**search_replace**: Search for content and replace it.
- Uses layered matching: exact → whitespace → indentation → fuzzy
- Reduces edit errors by ~9x

**insert_at_line**: Insert content at a specific line number.
- Line numbers are 1-based
- Content is inserted BEFORE the specified line
- Use line beyond EOF to append at end

**remove_lines**: Remove a range of lines from the file.
- Line numbers are 1-based and inclusive

For multiple edits, call this gadget multiple times.`,
	timeoutMs: 30000,
	maxConcurrent: 1, // Sequential execution to prevent race conditions on file writes
	schema: z.discriminatedUnion('mode', [
		// Mode 1: search_replace (current behavior)
		z.object({
			mode: z.literal('search_replace'),
			comment: z.string().min(1).describe('Brief rationale for this gadget call'),
			filePath: z.string().describe('Path to the file to edit'),
			search: z.string().min(1).describe('The content to search for'),
			replace: z.string().describe('The content to replace with (empty to delete)'),
		}),

		// Mode 2: insert_at_line
		z.object({
			mode: z.literal('insert_at_line'),
			comment: z.string().min(1).describe('Brief rationale for this gadget call'),
			filePath: z.string().describe('Path to the file to edit'),
			line: z
				.number()
				.int()
				.min(1)
				.describe('Line number to insert BEFORE (1-based). Use line beyond EOF to append.'),
			content: z.string().describe('Content to insert (can be multiline)'),
		}),

		// Mode 3: remove_lines
		z.object({
			mode: z.literal('remove_lines'),
			comment: z.string().min(1).describe('Brief rationale for this gadget call'),
			filePath: z.string().describe('Path to the file to edit'),
			startLine: z.number().int().min(1).describe('First line to remove (1-based, inclusive)'),
			endLine: z.number().int().min(1).describe('Last line to remove (1-based, inclusive)'),
		}),
	]),
	examples: [
		{
			params: {
				mode: 'search_replace' as const,
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
				mode: 'search_replace' as const,
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
				mode: 'search_replace' as const,
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
		// insert_at_line examples
		{
			params: {
				mode: 'insert_at_line' as const,
				comment: 'Adding lodash import at top of file',
				filePath: 'src/utils.ts',
				line: 1,
				content: "import _ from 'lodash';",
			},
			output: `path=src/utils.ts mode=insert_at_line status=success

Inserted 1 line at line 1.

--- BEFORE (around line 1) ---
>  1 | import { foo } from 'bar';
   2 | import { baz } from 'qux';
   3 |

--- AFTER ---
>  1 | import _ from 'lodash';
   2 | import { foo } from 'bar';
   3 | import { baz } from 'qux';
   4 |

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Insert import at beginning of file',
		},
		{
			params: {
				mode: 'insert_at_line' as const,
				comment: 'Adding helper function in middle of file',
				filePath: 'src/helpers.ts',
				line: 10,
				content: 'function validate(x: number): boolean {\n  return x > 0;\n}',
			},
			output: `path=src/helpers.ts mode=insert_at_line status=success

Inserted 3 lines at line 10.

--- BEFORE (around line 10) ---
   7 | }
   8 |
   9 | // Utils below
> 10 | function process(data: string) {
  11 |   return data.trim();
  12 | }

--- AFTER ---
   7 | }
   8 |
   9 | // Utils below
> 10 | function validate(x: number): boolean {
  11 |   return x > 0;
  12 | }
  13 | function process(data: string) {
  14 |   return data.trim();
  15 | }

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Insert multiline block in middle of file',
		},
		{
			params: {
				mode: 'insert_at_line' as const,
				comment: 'Appending export at end of file',
				filePath: 'src/index.ts',
				line: 999,
				content: "export * from './newModule';",
			},
			output: `path=src/index.ts mode=insert_at_line status=success

Appended 1 line at end of file.

--- BEFORE (end of file) ---
   3 | export * from './utils';
   4 | export * from './helpers';
   5 |

--- AFTER ---
   3 | export * from './utils';
   4 | export * from './helpers';
   5 |
>  6 | export * from './newModule';

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Append at end of file (line beyond EOF)',
		},
		// remove_lines examples
		{
			params: {
				mode: 'remove_lines' as const,
				comment: 'Removing unused import',
				filePath: 'src/app.ts',
				startLine: 3,
				endLine: 3,
			},
			output: `path=src/app.ts mode=remove_lines status=success

Removed 1 line (line 3).

--- BEFORE ---
   1 | import { foo } from 'foo';
   2 | import { bar } from 'bar';
>  3 | import { unused } from 'unused';
   4 | import { baz } from 'baz';
   5 |

--- AFTER ---
   1 | import { foo } from 'foo';
   2 | import { bar } from 'bar';
   3 | import { baz } from 'baz';
   4 |

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Remove single line',
		},
		{
			params: {
				mode: 'remove_lines' as const,
				comment: 'Removing deprecated function',
				filePath: 'src/legacy.ts',
				startLine: 5,
				endLine: 10,
			},
			output: `path=src/legacy.ts mode=remove_lines status=success

Removed 6 lines (lines 5-10).

--- BEFORE ---
   2 |
   3 | export function keepThis() {}
   4 |
>  5 | /** @deprecated */
>  6 | function oldFunc(x: number) {
>  7 |   console.log('deprecated');
>  8 |   return x * 2;
>  9 | }
> 10 |
  11 | export function keepThisToo() {}

--- AFTER ---
   2 |
   3 | export function keepThis() {}
   4 |
   5 | export function keepThisToo() {}

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Remove block of lines',
		},
		{
			params: {
				mode: 'remove_lines' as const,
				comment: 'Removing comment block from config',
				filePath: 'config/settings.json',
				startLine: 2,
				endLine: 4,
			},
			output: `path=config/settings.json mode=remove_lines status=success

Removed 3 lines (lines 2-4).

--- BEFORE ---
   1 | {
>  2 |   "// NOTE": "Remove this later",
>  3 |   "// TODO": "Clean up config",
>  4 |   "// FIXME": "Legacy value",
   5 |   "enabled": true,
   6 |   "timeout": 5000
   7 | }

--- AFTER ---
   1 | {
   2 |   "enabled": true,
   3 |   "timeout": 5000
   4 | }`,
			comment: 'Remove from non-TS file (no diagnostics)',
		},
	],
}) {
	override execute(params: this['params']): string {
		// Validate and resolve path (shared across all modes)
		const validatedPath = validatePath(params.filePath);

		// Dispatch to mode handler
		switch (params.mode) {
			case 'search_replace':
				return this.handleSearchReplace(
					params as Extract<this['params'], { mode: 'search_replace' }>,
					validatedPath,
				);
			case 'insert_at_line':
				return this.handleInsertAtLine(
					params as Extract<this['params'], { mode: 'insert_at_line' }>,
					validatedPath,
				);
			case 'remove_lines':
				return this.handleRemoveLines(
					params as Extract<this['params'], { mode: 'remove_lines' }>,
					validatedPath,
				);
		}
	}

	private handleSearchReplace(
		params: Extract<this['params'], { mode: 'search_replace' }>,
		validatedPath: string,
	): string {
		const { filePath, search, replace } = params;

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
			throw new Error(this.formatFailure(filePath, search, failure));
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
		writeFileSync(validatedPath, newContent, 'utf-8');
		invalidateFileRead(validatedPath);

		// Build and return success output
		return this.buildSearchReplaceOutput(
			filePath,
			validatedPath,
			matches,
			beforeContexts,
			replace,
			newContent,
		);
	}

	private handleInsertAtLine(
		params: Extract<this['params'], { mode: 'insert_at_line' }>,
		validatedPath: string,
	): string {
		const { filePath, line, content: insertContent } = params;

		// Read file content
		let content: string;
		try {
			content = readFileSync(validatedPath, 'utf-8');
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === 'ENOENT') {
				// For insert, create empty file
				content = '';
			} else {
				throw error;
			}
		}

		const lines = content.split('\n');
		const insertLines = insertContent.split('\n');
		const insertAtEnd = line > lines.length;
		const effectiveLine = Math.min(line, lines.length + 1);

		// Store before context
		const beforeContext = this.formatContext(lines, effectiveLine, effectiveLine, 3);

		// Insert lines
		const newLines = [
			...lines.slice(0, effectiveLine - 1),
			...insertLines,
			...lines.slice(effectiveLine - 1),
		];

		const newContent = newLines.join('\n');
		writeFileSync(validatedPath, newContent, 'utf-8');
		invalidateFileRead(validatedPath);

		// Build output
		const output: string[] = [`path=${filePath} mode=insert_at_line status=success`, ''];

		if (insertAtEnd) {
			output.push(
				`Appended ${insertLines.length} line${insertLines.length > 1 ? 's' : ''} at end of file.`,
			);
		} else {
			output.push(
				`Inserted ${insertLines.length} line${insertLines.length > 1 ? 's' : ''} at line ${effectiveLine}.`,
			);
		}

		output.push(
			'',
			insertAtEnd
				? '--- BEFORE (end of file) ---'
				: `--- BEFORE (around line ${effectiveLine}) ---`,
			beforeContext || '(empty file)',
			'',
			'--- AFTER ---',
			this.formatContext(newLines, effectiveLine, effectiveLine + insertLines.length - 1, 3),
		);

		if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
			output.push('', this.runDiagnostics(validatedPath));
		}

		return output.join('\n');
	}

	private handleRemoveLines(
		params: Extract<this['params'], { mode: 'remove_lines' }>,
		validatedPath: string,
	): string {
		const { filePath, startLine, endLine } = params;

		// Validate line range
		if (startLine > endLine) {
			throw new Error(`Invalid line range: startLine (${startLine}) > endLine (${endLine})`);
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

		const lines = content.split('\n');

		// Validate startLine
		if (startLine > lines.length) {
			throw new Error(`startLine (${startLine}) is beyond end of file (${lines.length} lines)`);
		}

		const effectiveEndLine = Math.min(endLine, lines.length);
		const removedCount = effectiveEndLine - startLine + 1;

		// Store before context with highlight on lines to remove
		const beforeContext = this.formatContext(lines, startLine, effectiveEndLine, 3);

		// Remove lines
		const newLines = [...lines.slice(0, startLine - 1), ...lines.slice(effectiveEndLine)];

		const newContent = newLines.join('\n');
		writeFileSync(validatedPath, newContent, 'utf-8');
		invalidateFileRead(validatedPath);

		// Build output
		const lineDesc =
			removedCount === 1 ? `line ${startLine}` : `lines ${startLine}-${effectiveEndLine}`;

		const output: string[] = [
			`path=${filePath} mode=remove_lines status=success`,
			'',
			`Removed ${removedCount} line${removedCount > 1 ? 's' : ''} (${lineDesc}).`,
			'',
			'--- BEFORE ---',
			beforeContext,
			'',
			'--- AFTER ---',
			this.formatContext(
				newLines,
				Math.max(1, startLine - 1),
				Math.min(newLines.length, startLine),
				3,
			) || '(empty file)',
		];

		if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
			output.push('', this.runDiagnostics(validatedPath));
		}

		return output.join('\n');
	}

	private buildSearchReplaceOutput(
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
	): string {
		const lines: string[] = [
			`ERROR: Search content NOT FOUND in file ${filePath}`,
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

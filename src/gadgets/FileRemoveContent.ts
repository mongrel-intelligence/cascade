/**
 * FileRemoveContent gadget - Remove a range of lines from a file.
 *
 * Line numbers are 1-based and inclusive.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { Gadget, z } from 'llmist';

import { invalidateFileRead } from './readTracking.js';
import {
	formatContext,
	runDiagnostics,
	shouldRunDiagnostics,
	validatePath,
} from './shared/index.js';

export class FileRemoveContent extends Gadget({
	name: 'FileRemoveContent',
	description: `Remove a range of lines from a file.

- Line numbers are 1-based and inclusive
- startLine and endLine define the range to remove`,
	timeoutMs: 30000,
	maxConcurrent: 1, // Sequential execution to prevent race conditions on file writes
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		filePath: z.string().describe('Path to the file to edit'),
		startLine: z.number().int().min(1).describe('First line to remove (1-based, inclusive)'),
		endLine: z.number().int().min(1).describe('Last line to remove (1-based, inclusive)'),
	}),
	examples: [
		// Example 1: Remove single line
		{
			params: {
				comment: 'Removing unused import',
				filePath: 'src/app.ts',
				startLine: 3,
				endLine: 3,
			},
			output: `path=src/app.ts status=success

Removed 1 line (line 3).

--- BEFORE ---
   1 | import { foo } from 'foo';
   2 | import { bar } from 'bar';
<  3 | import { unused } from 'unused';
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
		// Example 2: Remove block of lines (deprecated function)
		{
			params: {
				comment: 'Removing deprecated function',
				filePath: 'src/legacy.ts',
				startLine: 5,
				endLine: 10,
			},
			output: `path=src/legacy.ts status=success

Removed 6 lines (lines 5-10).

--- BEFORE ---
   2 |
   3 | export function keepThis() {}
   4 |
<  5 | /** @deprecated */
<  6 | function oldFunc(x: number) {
<  7 |   console.log('deprecated');
<  8 |   return x * 2;
<  9 | }
< 10 |
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
		// Example 3: Remove from non-TS file
		{
			params: {
				comment: 'Removing comment block from config',
				filePath: 'config/settings.json',
				startLine: 2,
				endLine: 4,
			},
			output: `path=config/settings.json status=success

Removed 3 lines (lines 2-4).

--- BEFORE ---
   1 | {
<  2 |   "// NOTE": "Remove this later",
<  3 |   "// TODO": "Clean up config",
<  4 |   "// FIXME": "Legacy value",
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
		const { filePath, startLine, endLine } = params;

		// Validate line range
		if (startLine > endLine) {
			throw new Error(`Invalid line range: startLine (${startLine}) > endLine (${endLine})`);
		}

		// Validate and resolve path
		const validatedPath = validatePath(filePath);

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
		const beforeContext = formatContext(lines, startLine, effectiveEndLine, 3, '<');

		// Remove lines
		const newLines = [...lines.slice(0, startLine - 1), ...lines.slice(effectiveEndLine)];

		const newContent = newLines.join('\n');
		writeFileSync(validatedPath, newContent, 'utf-8');
		invalidateFileRead(validatedPath);

		// Build output
		const lineDesc =
			removedCount === 1 ? `line ${startLine}` : `lines ${startLine}-${effectiveEndLine}`;

		const output: string[] = [
			`path=${filePath} status=success`,
			'',
			`Removed ${removedCount} line${removedCount > 1 ? 's' : ''} (${lineDesc}).`,
			'',
			'--- BEFORE ---',
			beforeContext,
			'',
			'--- AFTER ---',
			formatContext(
				newLines,
				Math.max(1, startLine - 1),
				Math.min(newLines.length, startLine),
				3,
			) || '(empty file)',
		];

		if (shouldRunDiagnostics(filePath)) {
			output.push('', runDiagnostics(validatedPath));
		}

		return output.join('\n');
	}
}

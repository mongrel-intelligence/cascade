/**
 * FileInsertContent gadget - Insert content before or after a specific line.
 *
 * Line numbers are 1-based. Use mode to specify insertion position.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { Gadget, z } from 'llmist';

import { invalidateFileRead } from './readTracking.js';
import { formatContext, runPostEditChecks, validatePath } from './shared/index.js';

export class FileInsertContent extends Gadget({
	name: 'FileInsertContent',
	description: `Insert content before or after a specific line in a file.

- Line numbers are 1-based
- Use mode='before' to insert BEFORE the line (new content appears at that line number)
- Use mode='after' to insert AFTER the line (new content appears at line+1)
- Use line=0 with mode='before' or line beyond EOF to append at end`,
	timeoutMs: 30000,
	maxConcurrent: 1, // Sequential execution to prevent race conditions on file writes
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		filePath: z.string().describe('Path to the file to edit'),
		line: z.number().int().min(0).describe('Line number (1-based). Use 0 to prepend at start.'),
		mode: z
			.enum(['before', 'after'])
			.describe("'before' inserts above the line, 'after' inserts below the line"),
		content: z.string().describe('Content to insert (can be multiline)'),
	}),
	examples: [
		// Example 1: Insert import at top of file (before line 1)
		{
			params: {
				comment: 'Adding lodash import at top of file',
				filePath: 'src/utils.ts',
				line: 1,
				mode: 'before',
				content: "import _ from 'lodash';",
			},
			output: `path=src/utils.ts status=success

Inserted 1 line before line 1.

>  1 | import _ from 'lodash';
   2 | import { foo } from 'bar';
   3 | import { baz } from 'qux';
   4 |

✓ No issues`,
			comment: 'Insert import at beginning of file (before line 1)',
		},
		// Example 2: Insert after a specific line
		{
			params: {
				comment: 'Adding new import after existing imports',
				filePath: 'src/utils.ts',
				line: 3,
				mode: 'after',
				content: "import { helper } from './helper';",
			},
			output: `path=src/utils.ts status=success

Inserted 1 line after line 3.

   1 | import { foo } from 'bar';
   2 | import { baz } from 'qux';
   3 | import { util } from 'utils';
>  4 | import { helper } from './helper';
   5 |
   6 | export function main() {

✓ No issues`,
			comment: 'Insert after line 3 (new content at line 4)',
		},
		// Example 3: Multi-line function insertion after a comment
		{
			params: {
				comment: 'Adding helper function after comment',
				filePath: 'src/helpers.ts',
				line: 9,
				mode: 'after',
				content: `function validate(x: number): boolean {
  return x > 0;
}`,
			},
			output: `path=src/helpers.ts status=success

Inserted 3 lines after line 9.

   7 | }
   8 |
   9 | // Utils below
> 10 | function validate(x: number): boolean {
> 11 |   return x > 0;
> 12 | }
  13 | function process(data: string) {
  14 |   return data.trim();
  15 | }

✓ No issues`,
			comment: 'Insert multiline block after line 9',
		},
		// Example 4: Append at end of file
		{
			params: {
				comment: 'Appending export at end of file',
				filePath: 'src/index.ts',
				line: 999,
				mode: 'after',
				content: "export * from './newModule';",
			},
			output: `path=src/index.ts status=success

Appended 1 line at end of file.

   3 | export * from './utils';
   4 | export * from './helpers';
   5 |
>  6 | export * from './newModule';

✓ No issues`,
			comment: 'Append at end of file (line beyond EOF)',
		},
		// Example 5: Insert interface before a class
		{
			params: {
				comment: 'Adding interface before UserService class',
				filePath: 'src/services/user.ts',
				line: 10,
				mode: 'before',
				content: `export interface UserData {
  id: string;
  name: string;
}

`,
			},
			output: `path=src/services/user.ts status=success

Inserted 5 lines before line 10.

   7 | import { db } from '../db';
   8 |
   9 | // Service implementation
> 10 | export interface UserData {
> 11 |   id: string;
> 12 |   name: string;
> 13 | }
> 14 |
  15 | export class UserService {
  16 |   async getUser(id: string) {

✓ No issues`,
			comment: 'Insert interface before the class at line 10',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { filePath, line, mode, content: insertContent } = params;

		// Validate and resolve path
		const validatedPath = validatePath(filePath);

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

		// Calculate insertion index based on mode
		let insertIndex: number;
		let insertAtEnd = false;

		if (mode === 'before') {
			// Insert before the specified line
			if (line === 0 || line > lines.length) {
				// line=0 or beyond EOF: append at end
				insertIndex = lines.length;
				insertAtEnd = line > lines.length;
			} else {
				insertIndex = line - 1; // Convert to 0-based
			}
		} else {
			// mode === 'after': Insert after the specified line
			if (line >= lines.length) {
				// At or beyond EOF: append at end
				insertIndex = lines.length;
				insertAtEnd = true;
			} else {
				insertIndex = line; // After line N means index N (0-based)
			}
		}

		// Insert lines
		const newLines = [...lines.slice(0, insertIndex), ...insertLines, ...lines.slice(insertIndex)];

		const newContent = newLines.join('\n');
		writeFileSync(validatedPath, newContent, 'utf-8');
		invalidateFileRead(validatedPath);

		// The effective line where content now appears (1-based)
		const effectiveLine = insertIndex + 1;

		// Check diagnostics and update state tracker
		const diagnosticResult = runPostEditChecks(filePath, validatedPath);
		const status = diagnosticResult?.hasErrors ? 'error' : 'success';

		// Build output
		const output: string[] = [`path=${filePath} status=${status}`, ''];

		if (insertAtEnd) {
			output.push(
				`Appended ${insertLines.length} line${insertLines.length > 1 ? 's' : ''} at end of file.`,
			);
		} else {
			output.push(
				`Inserted ${insertLines.length} line${insertLines.length > 1 ? 's' : ''} ${mode} line ${line}.`,
			);
		}

		output.push(
			'',
			formatContext(newLines, effectiveLine, effectiveLine + insertLines.length - 1, 3),
		);

		if (diagnosticResult) {
			output.push('', diagnosticResult.statusMessage);
		}

		return output.join('\n');
	}
}

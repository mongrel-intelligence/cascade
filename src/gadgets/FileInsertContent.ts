/**
 * FileInsertContent gadget - Insert content at a specific line number.
 *
 * Line numbers are 1-based. Content is inserted BEFORE the specified line.
 * Use a line beyond EOF to append at end.
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

export class FileInsertContent extends Gadget({
	name: 'FileInsertContent',
	description: `Insert content at a specific line number in a file.

- Line numbers are 1-based
- Content is inserted BEFORE the specified line (pushing that line down)
- To add after line N, insert before line N+1
- Use line beyond EOF to append at end

**Example**: To insert between lines 10 and 11, use line=11 (inserts BEFORE line 11).`,
	timeoutMs: 30000,
	maxConcurrent: 1, // Sequential execution to prevent race conditions on file writes
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		filePath: z.string().describe('Path to the file to edit'),
		line: z
			.number()
			.int()
			.min(1)
			.describe(
				'Line number to insert BEFORE (1-based). Content will appear at this line, pushing existing content down. To add after line N, use N+1.',
			),
		content: z.string().describe('Content to insert (can be multiline)'),
	}),
	examples: [
		// Example 1: Single-line import at top
		{
			params: {
				comment: 'Adding lodash import at top of file',
				filePath: 'src/utils.ts',
				line: 1,
				content: "import _ from 'lodash';",
			},
			output: `path=src/utils.ts status=success

Inserted 1 line at line 1.

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
		// Example 2: Multi-line function insertion
		{
			params: {
				comment: 'Adding helper function in middle of file',
				filePath: 'src/helpers.ts',
				line: 10,
				content: `function validate(x: number): boolean {
  return x > 0;
}`,
			},
			output: `path=src/helpers.ts status=success

Inserted 3 lines at line 10.

   7 | }
   8 |
   9 | // Utils below
> 10 | function validate(x: number): boolean {
> 11 |   return x > 0;
> 12 | }
  13 | function process(data: string) {
  14 |   return data.trim();
  15 | }

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Insert multiline block in middle of file',
		},
		// Example 3: Inserting a full interface definition
		{
			params: {
				comment: 'Adding User interface after imports',
				filePath: 'src/types/user.ts',
				line: 5,
				content: `export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  role: 'admin' | 'user' | 'guest';
  preferences: {
    theme: 'light' | 'dark';
    notifications: boolean;
  };
}`,
			},
			output: `path=src/types/user.ts status=success

Inserted 12 lines at line 5.

   2 | import type { BaseEntity } from './base';
   3 | import type { Preferences } from './preferences';
   4 |
>  5 | export interface User {
>  6 |   id: string;
>  7 |   email: string;
>  8 |   name: string;
>  9 |   createdAt: Date;
> 10 |   updatedAt: Date;
> 11 |   role: 'admin' | 'user' | 'guest';
> 12 |   preferences: {
> 13 |     theme: 'light' | 'dark';
> 14 |     notifications: boolean;
> 15 |   };
> 16 | }
  17 | // User types will be defined here
  18 |

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Insert complete interface definition',
		},
		// Example 4: Append at end of file
		{
			params: {
				comment: 'Appending export at end of file',
				filePath: 'src/index.ts',
				line: 999,
				content: "export * from './newModule';",
			},
			output: `path=src/index.ts status=success

Appended 1 line at end of file.

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
		// Example 5: Inserting a complete class
		{
			params: {
				comment: 'Adding Logger class implementation',
				filePath: 'src/utils/logger.ts',
				line: 8,
				content: `export class Logger {
  private readonly prefix: string;
  private readonly level: LogLevel;

  constructor(prefix: string, level: LogLevel = 'info') {
    this.prefix = prefix;
    this.level = level;
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({ timestamp, level, prefix: this.prefix, message, ...context }));
  }
}`,
			},
			output: `path=src/utils/logger.ts status=success

Inserted 22 lines at line 8.

   5 | type LogLevel = 'debug' | 'info' | 'warn' | 'error';
   6 |
   7 | // Logger implementation
>  8 | export class Logger {
>  9 |   private readonly prefix: string;
> 10 |   private readonly level: LogLevel;
> 11 |
> 12 |   constructor(prefix: string, level: LogLevel = 'info') {
> 13 |     this.prefix = prefix;
> 14 |     this.level = level;
> 15 |   }
> 16 |
> 17 |   info(message: string, context?: Record<string, unknown>): void {
> 18 |     this.log('info', message, context);
> 19 |   }
> 20 |
> 21 |   error(message: string, context?: Record<string, unknown>): void {
> 22 |     this.log('error', message, context);
> 23 |   }
> 24 |
> 25 |   private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
> 26 |     const timestamp = new Date().toISOString();
> 27 |     console.log(JSON.stringify({ timestamp, level, prefix: this.prefix, message, ...context }));
> 28 |   }
> 29 | }
  30 | export function createLogger(prefix: string) {

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Insert complete class definition',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { filePath, line, content: insertContent } = params;

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
		const insertAtEnd = line > lines.length;
		const effectiveLine = Math.min(line, lines.length + 1);

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
		const output: string[] = [`path=${filePath} status=success`, ''];

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
			formatContext(newLines, effectiveLine, effectiveLine + insertLines.length - 1, 3),
		);

		if (shouldRunDiagnostics(filePath)) {
			output.push('', runDiagnostics(validatedPath));
		}

		return output.join('\n');
	}
}

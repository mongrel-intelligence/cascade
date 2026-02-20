/**
 * WriteFile gadget - Write content to a file with read tracking.
 *
 * After writing, marks the file as read (the agent wrote the content,
 * so it knows what's in the file) to avoid unnecessary re-reads.
 *
 * Allows writing to:
 * - Current working directory and subdirectories
 * - /tmp directory (for test outputs, build artifacts, etc.)
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { Gadget, z } from 'llmist';

import { markFileRead } from './readTracking.js';
import { runPostEditChecks } from './shared/index.js';
import { validatePath } from './shared/pathValidation.js';

export class WriteFile extends Gadget({
	name: 'WriteFile',
	description: `Write content to a file. Creates parent directories if needed. Overwrites existing files.

Allowed paths:
- Current working directory and subdirectories
- /tmp directory`,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		filePath: z.string().describe('Path to the file to write (relative or absolute)'),
		content: z.string().describe('Content to write to the file'),
	}),
	examples: [
		{
			params: {
				comment: 'Creating output file for test results',
				filePath: 'output.txt',
				content: 'Hello, World!',
			},
			output: 'path=output.txt\n\nWrote 13 bytes',
			comment: 'Write a simple text file (no diagnostics for non-TS files)',
		},
		{
			params: {
				comment: 'Creating config with trailing newline',
				filePath: 'config.json',
				content: '{\n  "enabled": true\n}\n',
			},
			output: 'path=config.json\n\nWrote 23 bytes',
			comment: 'End content with \\n for a trailing newline (required by some linters)',
		},
		{
			params: {
				comment: 'Adding new helper utility function',
				filePath: 'src/utils/helper.ts',
				content: 'export function helper() {}',
			},
			output: `path=src/utils/helper.ts status=success

Wrote 27 bytes (created directory: src/utils)

✓ No issues`,
			comment: 'Write a TypeScript file with simplified diagnostics',
		},
		{
			params: {
				comment: 'Creating user service class',
				filePath: 'src/services/userService.ts',
				content: `import { db } from '../db';
import type { User } from '../types';

export class UserService {
  async getUser(id: string): Promise<User | null> {
    return db.users.findById(id);
  }

  async createUser(data: Partial<User>): Promise<User> {
    return db.users.create(data);
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    const user = await this.getUser(id);
    if (!user) {
      throw new Error(\`User not found: \${id}\`);
    }
    return db.users.update(id, data);
  }

  async deleteUser(id: string): Promise<void> {
    await db.users.delete(id);
  }
}`,
			},
			output: `path=src/services/userService.ts status=success

Wrote 542 bytes

✓ No issues`,
			comment: 'Write a complete TypeScript file with multi-line content',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { filePath, content } = params;

		let validatedPath: string;
		try {
			validatedPath = validatePath(filePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return `path=${filePath} status=error\n\nError: ${message}`;
		}

		// Create parent directories if needed
		const parentDir = dirname(validatedPath);
		let createdDir = false;
		if (!existsSync(parentDir)) {
			// Validate parent directory path as well
			try {
				validatePath(parentDir);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return `path=${filePath} status=error\n\nError: ${message}`;
			}
			mkdirSync(parentDir, { recursive: true });
			createdDir = true;
		}

		// Write the file
		try {
			writeFileSync(validatedPath, content, 'utf-8');
			// Agent wrote this content — it knows what's in the file
			markFileRead(validatedPath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return `path=${filePath} status=error\n\nError writing file: ${message}`;
		}

		const bytesWritten = Buffer.byteLength(content, 'utf-8');
		const dirNote = createdDir ? ` (created directory: ${dirname(filePath)})` : '';

		// Check diagnostics and update state tracker
		const diagnosticResult = runPostEditChecks(filePath, validatedPath);
		const status = diagnosticResult?.hasErrors ? 'error' : 'success';
		const diagnosticsOutput = diagnosticResult ? `\n\n${diagnosticResult.statusMessage}` : '';

		return `path=${filePath} status=${status}\n\nWrote ${bytesWritten} bytes${dirNote}${diagnosticsOutput}`;
	}
}

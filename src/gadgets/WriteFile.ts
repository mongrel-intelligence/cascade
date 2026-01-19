/**
 * WriteFile gadget - Write content to a file with read tracking invalidation.
 *
 * Custom version that invalidates read tracking after writing, ensuring
 * subsequent ReadFile calls return fresh content instead of cached responses.
 *
 * Allows writing to:
 * - Current working directory and subdirectories
 * - /tmp directory (for test outputs, build artifacts, etc.)
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

import { Gadget, z } from 'llmist';

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
			output: `path=src/utils/helper.ts

Wrote 27 bytes (created directory: src/utils)

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Write a TypeScript file with diagnostics output',
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
			output: `path=src/services/userService.ts

Wrote 542 bytes

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
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
			// Invalidate read tracking so subsequent reads return fresh content
			invalidateFileRead(validatedPath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return `path=${filePath} status=error\n\nError writing file: ${message}`;
		}

		const bytesWritten = Buffer.byteLength(content, 'utf-8');
		const dirNote = createdDir ? ` (created directory: ${dirname(filePath)})` : '';

		let diagnostics = '';
		if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
			diagnostics = `\n\n${this.runDiagnostics(validatedPath)}`;
		}

		return `path=${filePath}\n\nWrote ${bytesWritten} bytes${dirNote}${diagnostics}`;
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
			// Filter to errors in the written file, but keep full error messages
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

		// Biome lint and format (auto-fix)
		try {
			const biomeOutput = execSync(`npx biome check --write "${filePath}"`, {
				encoding: 'utf-8',
				cwd: process.cwd(),
				timeout: 10000,
				stdio: 'pipe',
			});
			sections.push('');
			sections.push('=== Biome Lint ===');
			// Check if any fixes were applied
			if (biomeOutput.includes('Fixed')) {
				sections.push(biomeOutput.trim());
			} else {
				sections.push('No lint issues found.');
			}
		} catch (error) {
			const execError = error as { stdout?: string; stderr?: string };
			// Biome outputs diagnostics to stdout, summary to stderr - capture both
			const output = [execError.stdout, execError.stderr].filter(Boolean).join('\n');
			sections.push('');
			sections.push('=== Biome Lint ===');
			// Even with --write, some issues may not be auto-fixable
			sections.push(output.trim() || 'No lint issues found.');
		}

		return sections.join('\n');
	}
}

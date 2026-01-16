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
		filePath: z.string().describe('Path to the file to write (relative or absolute)'),
		content: z.string().describe('Content to write to the file'),
	}),
	examples: [
		{
			params: { filePath: 'output.txt', content: 'Hello, World!' },
			output: 'path=output.txt\n\nWrote 13 bytes',
			comment: 'Write a simple text file',
		},
		{
			params: { filePath: 'src/utils/helper.ts', content: 'export function helper() {}' },
			output: 'path=src/utils/helper.ts\n\nWrote 27 bytes (created directory: src/utils)',
			comment: 'Write a file, creating parent directories',
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
		return `path=${filePath}\n\nWrote ${bytesWritten} bytes${dirNote}`;
	}
}

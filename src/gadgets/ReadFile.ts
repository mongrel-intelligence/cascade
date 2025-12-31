/**
 * ReadFile gadget - Read file contents with expanded path access.
 *
 * Allows reading from:
 * - Current working directory and subdirectories
 * - /tmp directory (for test logs, build artifacts, etc.)
 */
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { Gadget, z } from 'llmist';

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

export class ReadFile extends Gadget({
	name: 'ReadFile',
	description: `Read the entire content of a file and return it as text.

Allowed paths:
- Current working directory and subdirectories
- /tmp directory (for test logs, build artifacts, etc.)`,
	schema: z.object({
		filePath: z.string().describe('Path to the file to read (relative or absolute)'),
	}),
	examples: [
		{
			params: { filePath: 'package.json' },
			output: 'path=package.json\n\n{\n  "name": "my-project",\n  "version": "1.0.0"\n  ...\n}',
			comment: 'Read a JSON config file',
		},
		{
			params: { filePath: '/tmp/test.log' },
			output: 'path=/tmp/test.log\n\n[Test output...]',
			comment: 'Read a test log from /tmp',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { filePath } = params;
		const validatedPath = validatePath(filePath);
		const content = readFileSync(validatedPath, 'utf-8');
		return `path=${filePath}\n\n${content}`;
	}
}

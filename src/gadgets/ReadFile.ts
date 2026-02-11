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

import { hasReadFile, markFileRead } from './readTracking.js';

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
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		filePath: z
			.string()
			.describe(
				'Path to the file to read (relative or absolute). ONLY VALID PATHS ALLOWED. Use ListDirectory to confirm full path.',
			),
	}),
	examples: [
		{
			params: {
				comment: 'Reading source file to understand implementation',
				filePath: 'src/utils.ts',
			},
			output:
				'path=src/utils.ts\n\nexport function add(a: number, b: number) {\n  return a + b;\n}',
			comment: 'Returns raw file content',
		},
		{
			params: {
				comment: 'Checking test output for failures',
				filePath: '/tmp/test.log',
			},
			output: 'path=/tmp/test.log\n\nPASS src/utils.test.ts\n  ✓ adds numbers correctly',
			comment: 'Read a test log from /tmp',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		const { filePath } = params;
		const validatedPath = validatePath(filePath);

		// Check if already read in this session (content is in context)
		if (hasReadFile(validatedPath)) {
			return `path=${filePath}\n\n[Already read - refer to previous content in context]`;
		}

		const content = readFileSync(validatedPath, 'utf-8');
		markFileRead(validatedPath);

		return `path=${filePath}\n\n${content}`;
	}
}

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
		showLineNumbers: z
			.boolean()
			.optional()
			.default(false)
			.describe('If true, prefix each line with its 1-based line number (e.g., "   1 | content")'),
	}),
	examples: [
		{
			params: {
				comment: 'Reading config to understand project structure',
				filePath: 'package.json',
				showLineNumbers: false,
			},
			output: 'path=package.json\n\n{\n  "name": "my-project",\n  "version": "1.0.0"\n  ...\n}',
			comment: 'Read a JSON config file',
		},
		{
			params: {
				comment: 'Checking test output for failures',
				filePath: '/tmp/test.log',
				showLineNumbers: false,
			},
			output: 'path=/tmp/test.log\n\n[Test output...]',
			comment: 'Read a test log from /tmp',
		},
		{
			params: {
				comment: 'Reading with line numbers for precise editing',
				filePath: 'src/utils.ts',
				showLineNumbers: true,
			},
			output:
				'path=src/utils.ts\n\n 1 | export function add(a: number, b: number) {\n 2 |   return a + b;\n 3 | }',
			comment: 'Read with line numbers for insert_at_line or remove_lines operations',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { filePath, showLineNumbers = false } = params;
		const validatedPath = validatePath(filePath);

		// Check if already read in this session (content is in context)
		if (hasReadFile(validatedPath)) {
			return `path=${filePath}\n\n[Already read - refer to previous content in context]`;
		}

		let content = readFileSync(validatedPath, 'utf-8');
		markFileRead(validatedPath);

		if (showLineNumbers) {
			content = this.addLineNumbers(content);
		}

		return `path=${filePath}\n\n${content}`;
	}

	private addLineNumbers(content: string): string {
		const lines = content.split('\n');
		const width = String(lines.length).length;
		return lines.map((line, i) => `${String(i + 1).padStart(width)} | ${line}`).join('\n');
	}
}

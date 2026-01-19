/**
 * ReadFile gadget - Read file contents with expanded path access.
 *
 * Allows reading from:
 * - Current working directory and subdirectories
 * - /tmp directory (for test logs, build artifacts, etc.)
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { auRead } from 'au';
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
				'path=src/utils.ts\n\n 1 | export function add(a: number, b: number) {\n 2 |   return a + b;\n 3 | }',
			comment: 'Line numbers included for precise editing',
		},
		{
			params: {
				comment: 'Checking test output for failures',
				filePath: '/tmp/test.log',
			},
			output: 'path=/tmp/test.log\n\n 1 | PASS src/utils.test.ts\n 2 |   ✓ adds numbers correctly',
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

		const fullContent = readFileSync(validatedPath, 'utf-8');
		const allLines = fullContent.split('\n');
		const totalLines = allLines.length;

		markFileRead(validatedPath);

		const content = this.addLineNumbers(allLines, 1, totalLines);
		const header = `path=${filePath}`;

		// Try to include AU understanding if available
		const auUnderstanding = await this.getAUUnderstanding(filePath);

		if (auUnderstanding) {
			return `${header}\n\n## Understanding\n${auUnderstanding}\n\n## Content\n${content}`;
		}

		return `${header}\n\n${content}`;
	}

	private addLineNumbers(lines: string[], startLine: number, totalLines: number): string {
		const width = String(totalLines).length;
		return lines.map((line, i) => `${String(startLine + i).padStart(width)} | ${line}`).join('\n');
	}

	private async getAUUnderstanding(filePath: string): Promise<string | null> {
		const cwd = process.cwd();

		// Check if AU is enabled (repo has .au file at root)
		if (!existsSync(join(cwd, '.au'))) {
			return null;
		}

		try {
			// Use relative path for AU lookup
			const relativePath = relative(cwd, resolve(cwd, filePath)) || filePath;
			const result = (await auRead.execute({
				comment: `Fetching understanding for ${relativePath}`,
				paths: relativePath,
			})) as string;

			// Return null if no understanding exists
			if (!result || result.includes('No understanding exists yet')) {
				return null;
			}

			return result;
		} catch {
			// AU lookup failed, continue without it
			return null;
		}
	}
}

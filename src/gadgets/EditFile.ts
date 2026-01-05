/**
 * EditFile gadget - Edit files using search/replace with layered matching.
 *
 * Uses layered matching strategies: exact → whitespace → indentation → fuzzy
 * This approach reduces edit errors by ~9x (per Aider benchmarks).
 */

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { Gadget, z } from 'llmist';

import { applyReplacement, findMatch, getMatchFailure } from './editfile/matcher.js';

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

export class EditFile extends Gadget({
	name: 'EditFile',
	description: `Edit a file by searching for content and replacing it.

Uses layered matching strategies (in order):
1. Exact match - byte-for-byte comparison
2. Whitespace-insensitive - ignores differences in spaces/tabs
3. Indentation-preserving - matches structure ignoring leading whitespace
4. Fuzzy match - similarity-based matching (80% threshold)

For multiple edits to the same file, call this gadget multiple times.
Each call provides immediate feedback, allowing you to adjust subsequent edits.

Allowed paths:
- Current working directory and subdirectories
- /tmp directory`,
	timeoutMs: 30000,
	schema: z.object({
		filePath: z.string().describe('Path to the file to edit (relative or absolute)'),
		search: z.string().describe('The content to search for in the file'),
		replace: z.string().describe('The content to replace it with (empty string to delete)'),
	}),
	examples: [
		{
			params: {
				filePath: 'src/config.ts',
				search: 'const DEBUG = false;',
				replace: 'const DEBUG = true;',
			},
			output:
				'path=src/config.ts status=success strategy=exact lines=5-5\n\nReplaced content successfully.',
			comment: 'Simple single-line edit',
		},
		{
			params: {
				filePath: 'src/utils.ts',
				search: `function oldHelper() {
  return 1;
}`,
				replace: `function newHelper() {
  return 2;
}`,
			},
			output:
				'path=src/utils.ts status=success strategy=exact lines=10-12\n\nReplaced content successfully.',
			comment: 'Multi-line replacement',
		},
		{
			params: {
				filePath: 'src/app.ts',
				search: 'unusedImport',
				replace: '',
			},
			output:
				'path=src/app.ts status=success strategy=exact lines=3-3\n\nReplaced content successfully.',
			comment: 'Delete content by replacing with empty string',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { filePath, search, replace } = params;

		// Validate search is not empty
		if (search.trim() === '') {
			return `path=${filePath} status=error\n\nError: Search content cannot be empty.`;
		}

		// Validate and resolve path
		let validatedPath: string;
		try {
			validatedPath = validatePath(filePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return `path=${filePath} status=error\n\nError: ${message}`;
		}

		// Read file content
		let content: string;
		try {
			content = readFileSync(validatedPath, 'utf-8');
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === 'ENOENT') {
				return `path=${filePath} status=error\n\nError: File not found: ${filePath}`;
			}
			const message = error instanceof Error ? error.message : String(error);
			return `path=${filePath} status=error\n\nError reading file: ${message}`;
		}

		// Find match using layered strategies
		const match = findMatch(content, search);

		if (!match) {
			// No match found - provide helpful suggestions
			const failure = getMatchFailure(content, search);
			return this.formatFailure(filePath, search, failure, content);
		}

		// Apply replacement
		const newContent = applyReplacement(content, match, replace);

		// Write file
		try {
			writeFileSync(validatedPath, newContent, 'utf-8');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return `path=${filePath} status=error\n\nError writing file: ${message}`;
		}

		return `path=${filePath} status=success strategy=${match.strategy} lines=${match.startLine}-${match.endLine}\n\nReplaced content successfully.`;
	}

	private formatFailure(
		filePath: string,
		search: string,
		failure: {
			reason: string;
			suggestions: Array<{ content: string; lineNumber: number; similarity: number }>;
			nearbyContext: string;
		},
		fileContent: string,
	): string {
		const lines: string[] = [
			`path=${filePath} status=failed`,
			'',
			`Error: ${failure.reason}`,
			'',
			'SEARCH CONTENT:',
			'```',
			search,
			'```',
		];

		if (failure.suggestions.length > 0) {
			lines.push('', 'SUGGESTIONS (similar content found):');
			for (const suggestion of failure.suggestions) {
				const percent = Math.round(suggestion.similarity * 100);
				lines.push(
					'',
					`Line ${suggestion.lineNumber} (${percent}% similar):`,
					'```',
					suggestion.content,
					'```',
				);
			}

			if (failure.nearbyContext) {
				lines.push('', 'CONTEXT:', failure.nearbyContext);
			}
		}

		lines.push('', 'CURRENT FILE CONTENT:', '```', fileContent, '```');

		return lines.join('\n');
	}
}

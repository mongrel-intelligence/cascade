/**
 * FileSedCommand gadget - Edit a file using a sed command.
 *
 * Experimental alternative to FileSearchAndReplace that gives models
 * more flexibility for complex edits via sed expressions.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { Gadget, z } from 'llmist';

import { invalidateFileRead } from './readTracking.js';
import { runDiagnostics, shouldRunDiagnostics, validatePath } from './shared/index.js';

export class FileSedCommand extends Gadget({
	name: 'FileSedCommand',
	description: `Edit a file using a sed command. NOT for searching - use RipGrep or ReadFile instead.

**The sed parameter must be a valid sed expression**, such as:
- Replace: sed='s/old/new/g'
- Multiline: sed='s/import \\{\\nfoo/import \\{\\nbar/g'
- Delete lines: sed='/pattern/d'

**Important**:
- Supports multiline patterns (-z flag) - use \\n for newlines
- Uses extended regex (-E flag)
- Uses GNU sed (gsed on macOS)
- Modifies the file in-place

**ERE Escaping** (required for literal characters):
- \\{ and \\} for curly braces
- \\[ and \\] for square brackets
- \\( and \\) for parentheses
- \\. for dots, \\* for asterisks`,
	timeoutMs: 30000,
	maxConcurrent: 1,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this edit'),
		filePath: z.string().describe('Path to the file to edit'),
		sed: z
			.string()
			.min(1)
			.describe(
				"Sed expression - must start with s/, /pattern/, or line address (e.g., 's/old/new/g', '/pattern/d')",
			),
	}),
	examples: [
		{
			params: {
				comment: 'Updating timeout value',
				filePath: 'src/config.ts',
				sed: 's/timeout: 1000/timeout: 5000/',
			},
			output: 'path=src/config.ts status=success\n\n[diff output]',
			comment: 'Simple substitution',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { filePath, sed } = params;
		const validatedPath = validatePath(filePath);

		// Validate sed expression format
		const validSedCommands = /^(s\/|\/.*\/[dpaicq]|[0-9,]*[dpaicqs])/;
		if (!validSedCommands.test(sed)) {
			throw new Error(
				`Invalid sed expression: "${sed}"\n\nThe sed parameter must be a valid sed command, such as:\n  - s/old/new/g  (substitute)\n  - /pattern/d   (delete lines matching pattern)\n  - /pattern/a\\text  (append after matching lines)\n\nTo SEARCH for content, use ReadFile instead.`,
			);
		}

		// Read before content for diff
		const beforeContent = readFileSync(validatedPath, 'utf-8');

		// Run sed with -E for extended regex (use gsed on macOS for GNU sed compatibility)
		const sedCmd = process.platform === 'darwin' ? 'gsed' : 'sed';
		try {
			execSync(`${sedCmd} -i -z -E '${sed}' '${validatedPath}'`, {
				encoding: 'utf-8',
				stdio: ['pipe', 'pipe', 'pipe'],
			});
		} catch (error) {
			const err = error as Error & { stderr?: string };
			const stderr = err.stderr || err.message;

			// Provide helpful hint for common escaping errors
			if (stderr.includes('Invalid content of')) {
				throw new Error(
					`Sed command failed: ${stderr}\n\nHint: In extended regex (-E), curly braces { } are special.\nTo match literal braces, escape them: \\{ and \\}\nConsider using AstGrep for code with braces.`,
				);
			}

			throw new Error(`Sed command failed: ${stderr}`);
		}

		// Invalidate read cache
		invalidateFileRead(validatedPath);

		// Read after content
		const afterContent = readFileSync(validatedPath, 'utf-8');

		// Check if anything changed
		if (beforeContent === afterContent) {
			return `path=${filePath} status=no_change\n\nSed command matched nothing.`;
		}

		// Build diff output
		const diff = this.buildDiff(beforeContent, afterContent);

		// Run diagnostics for TS files
		let diagnostics = '';
		if (shouldRunDiagnostics(filePath)) {
			diagnostics = runDiagnostics(validatedPath);
		}

		return `path=${filePath} status=success\n\n${diff}${diagnostics ? `\n\n${diagnostics}` : ''}`;
	}

	private buildDiff(before: string, after: string): string {
		// Simple line-by-line diff
		const beforeLines = before.split('\n');
		const afterLines = after.split('\n');

		const changes: string[] = [];
		const maxLines = Math.max(beforeLines.length, afterLines.length);

		for (let i = 0; i < maxLines; i++) {
			const bLine = beforeLines[i];
			const aLine = afterLines[i];
			if (bLine !== aLine) {
				if (bLine !== undefined) changes.push(`- ${i + 1} | ${bLine}`);
				if (aLine !== undefined) changes.push(`+ ${i + 1} | ${aLine}`);
			}
		}

		return changes.length > 0 ? changes.join('\n') : '(no visible changes)';
	}
}

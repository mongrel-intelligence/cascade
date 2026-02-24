/**
 * FileMultiEdit gadget - Apply multiple search/replace edits atomically.
 *
 * All edits are applied to in-memory content sequentially. If any edit fails
 * to find a match, ALL changes are aborted and the file remains unchanged.
 * This prevents broken intermediate states from partial refactors.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { Gadget, z } from 'llmist';

import { assertFileRead, markFileRead } from './readTracking.js';
import { withEscalationHint } from './shared/editEscalation.js';
import {
	adjustIndentation,
	applyReplacement,
	clearEditFailure,
	findAllMatches,
	formatContext,
	getMatchFailure,
	runPostEditChecks,
	validatePath,
} from './shared/index.js';

export class FileMultiEdit extends Gadget({
	name: 'FileMultiEdit',
	description: `Apply multiple search/replace edits to a single file atomically.

All edits are applied in order. Each edit searches the content as modified by previous edits.
If ANY edit fails to find its match, ALL changes are aborted — the file stays unchanged.

Use this instead of multiple FileSearchAndReplace calls when edits are related
(e.g., rename a parameter in the signature AND update all usages in the body).`,
	timeoutMs: 30000,
	maxConcurrent: 1,
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		filePath: z.string().describe('Path to the file to edit'),
		edits: z
			.array(
				z.object({
					search: z.string().min(1).describe('The content to search for'),
					replace: z.string().describe('The content to replace with (empty to delete)'),
				}),
			)
			.min(1)
			.max(20)
			.describe('Array of search/replace pairs to apply in order'),
	}),
	examples: [
		{
			params: {
				comment: 'Renaming parameter and updating usage in function body',
				filePath: 'src/utils.ts',
				edits: [
					{
						search: 'function process(data: string)',
						replace: 'function process(input: string)',
					},
					{
						search: 'return data.trim();',
						replace: 'return input.trim();',
					},
				],
			},
			output: `path=src/utils.ts status=success edits=2/2

=== Edit 1 (lines 5-5) ===
< function process(data: string)
> function process(input: string)

=== Edit 2 (lines 6-6) ===
< return data.trim();
> return input.trim();

✓ No issues`,
			comment: 'Atomic multi-edit: rename parameter and update usage together',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { filePath, edits } = params;

		const validatedPath = validatePath(filePath);
		assertFileRead(validatedPath, 'FileMultiEdit');

		let content: string;
		try {
			content = readFileSync(validatedPath, 'utf-8');
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === 'ENOENT') {
				throw new Error(`File not found: ${filePath}`);
			}
			throw error;
		}

		// Apply all edits to in-memory content
		let workingContent = content;
		const editResults: Array<{
			index: number;
			beforeLines: string;
			afterLines: string;
			startLine: number;
			endLine: number;
			strategy: string;
		}> = [];

		for (let i = 0; i < edits.length; i++) {
			const edit = edits[i];
			const matches = findAllMatches(workingContent, edit.search);

			if (matches.length === 0) {
				const failure = getMatchFailure(workingContent, edit.search);
				throw new Error(
					withEscalationHint(
						this.formatAbortError(filePath, i + 1, edits.length, edit.search, failure),
						validatedPath,
					),
				);
			}

			if (matches.length > 1) {
				throw new Error(
					withEscalationHint(
						`ABORTED: Edit ${i + 1}/${edits.length} found ${matches.length} matches (expected 1) in ${filePath}\n\nAdd more surrounding context to uniquely identify the target.\n\nNo changes were made to the file.`,
						validatedPath,
					),
				);
			}

			const match = matches[0];

			// Adjust replacement indentation if matched via indentation strategy
			const adjustedReplace =
				match.strategy === 'indentation' && match.indentationDelta
					? adjustIndentation(edit.replace, match.indentationDelta)
					: edit.replace;

			// Record before context
			const beforeLines = workingContent.split('\n');
			const beforeContext = formatContext(beforeLines, match.startLine, match.endLine, 0, '<');

			// Apply this edit in memory
			workingContent = applyReplacement(workingContent, match, adjustedReplace);

			// Record after context
			const afterLines = workingContent.split('\n');
			const replacementLineCount = adjustedReplace.split('\n').length;
			const afterEndLine = match.startLine + replacementLineCount - 1;
			const afterContext = formatContext(afterLines, match.startLine, afterEndLine, 0);

			editResults.push({
				index: i + 1,
				beforeLines: beforeContext,
				afterLines: afterContext,
				startLine: match.startLine,
				endLine: match.endLine,
				strategy: match.strategy,
			});
		}

		// All edits succeeded — write to disk
		writeFileSync(validatedPath, workingContent, 'utf-8');
		markFileRead(validatedPath);
		clearEditFailure(validatedPath);

		// Run post-edit checks once
		const diagnosticResult = runPostEditChecks(filePath, validatedPath);
		const status = diagnosticResult?.hasErrors ? 'error' : 'success';

		// Build consolidated output
		const output: string[] = [
			`path=${filePath} status=${status} edits=${edits.length}/${edits.length}`,
		];

		for (const result of editResults) {
			output.push(
				'',
				`=== Edit ${result.index} (lines ${result.startLine}-${result.endLine}) ===`,
				result.beforeLines,
				result.afterLines,
			);
		}

		if (diagnosticResult) {
			output.push('', diagnosticResult.statusMessage);
		}

		return output.join('\n');
	}

	private formatAbortError(
		filePath: string,
		editIndex: number,
		totalEdits: number,
		search: string,
		failure: {
			reason: string;
			suggestions: Array<{
				content: string;
				lineNumber: number;
				similarity: number;
			}>;
		},
	): string {
		const lines: string[] = [
			`ABORTED: Edit ${editIndex}/${totalEdits} failed — no match found in ${filePath}`,
			'',
			'No changes were made to the file.',
			'',
			'Failed search:',
			'```',
			search,
			'```',
		];

		if (failure.suggestions.length > 0) {
			lines.push('', 'Similar content found:');
			for (const suggestion of failure.suggestions.slice(0, 2)) {
				const percent = Math.round(suggestion.similarity * 100);
				lines.push(
					'',
					`--- line ${suggestion.lineNumber} (${percent}% match) ---`,
					'```',
					suggestion.content,
					'```',
				);
			}
		}

		lines.push('', 'TIP: Re-read the file and retry all edits together.');

		return lines.join('\n');
	}
}

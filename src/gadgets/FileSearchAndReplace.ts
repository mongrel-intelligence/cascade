/**
 * FileSearchAndReplace gadget - Search for content and replace it.
 *
 * Uses layered matching strategies: exact → whitespace → indentation → fuzzy
 * This approach reduces edit errors by ~9x (per Aider benchmarks).
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { Gadget, z } from 'llmist';

import { invalidateFileRead } from './readTracking.js';
import {
	applyReplacement,
	findAllMatches,
	formatContext,
	getMatchFailure,
	runDiagnosticsWithTracking,
	validatePath,
} from './shared/index.js';
import type { MatchResult } from './shared/types.js';

export class FileSearchAndReplace extends Gadget({
	name: 'FileSearchAndReplace',
	description: `Search for content in a file and replace it.

Uses layered matching: exact → whitespace → indentation → fuzzy
This reduces edit errors by ~9x.

By default, requires exactly ONE match (use surrounding context to disambiguate).
Set replaceAll=true to replace ALL matches (for bulk renames or removing duplicates).`,
	timeoutMs: 30000,
	maxConcurrent: 1, // Sequential execution to prevent race conditions on file writes
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		filePath: z.string().describe('Path to the file to edit'),
		search: z.string().min(1).describe('The content to search for'),
		replace: z.string().describe('The content to replace with (empty to delete)'),
		replaceAll: z
			.boolean()
			.optional()
			.describe(
				'Replace ALL occurrences (default: false). Use for bulk renames or removing duplicates.',
			),
	}),
	examples: [
		// Example 1: Single-line replacement
		{
			params: {
				comment: 'Increasing timeout from 1s to 5s to fix test flakiness',
				filePath: 'src/config.ts',
				search: 'timeout: 1000',
				replace: 'timeout: 5000',
			},
			output: `path=src/config.ts status=success strategy=exact

=== Edit (lines 5-5) ===
--- BEFORE ---
   1 | import { foo } from "bar";
   2 |
   3 | const CONFIG = {
   4 |   debug: false,
<  5 |   timeout: 1000,
   6 |   retries: 3,
   7 | };

--- AFTER ---
   1 | import { foo } from "bar";
   2 |
   3 | const CONFIG = {
   4 |   debug: false,
>  5 |   timeout: 5000,
   6 |   retries: 3,
   7 | };

✓ No issues`,
			comment: 'Single edit with before/after context and simplified diagnostics',
		},
		// Example 2: Multi-line function replacement
		{
			params: {
				comment: 'Replacing sync function with async implementation',
				filePath: 'src/api/users.ts',
				search: `function getUser(id: string): User | null {
  const user = userCache.get(id);
  return user || null;
}`,
				replace: `async function getUser(id: string): Promise<User | null> {
  // Check cache first
  const cached = userCache.get(id);
  if (cached) return cached;

  // Fetch from database
  const user = await db.users.findById(id);
  if (user) {
    userCache.set(id, user);
  }
  return user;
}`,
			},
			output: `path=src/api/users.ts status=success strategy=exact

=== Edit (lines 12-15) ===
--- BEFORE ---
   9 | import { db } from '../db';
  10 | import { userCache } from '../cache';
  11 |
< 12 | function getUser(id: string): User | null {
< 13 |   const user = userCache.get(id);
< 14 |   return user || null;
< 15 | }
  16 |
  17 | function updateUser(id: string, data: Partial<User>): void {

--- AFTER ---
   9 | import { db } from '../db';
  10 | import { userCache } from '../cache';
  11 |
> 12 | async function getUser(id: string): Promise<User | null> {
> 13 |   // Check cache first
> 14 |   const cached = userCache.get(id);
> 15 |   if (cached) return cached;
> 16 |
> 17 |   // Fetch from database
> 18 |   const user = await db.users.findById(id);
> 19 |   if (user) {
> 20 |     userCache.set(id, user);
> 21 |   }
> 22 |   return user;
> 23 | }
  24 |
  25 | function updateUser(id: string, data: Partial<User>): void {

✓ No issues`,
			comment: 'Replace entire function with new async implementation',
		},
		// Example 3: Adding error handling to existing code
		{
			params: {
				comment: 'Adding try-catch error handling to API call',
				filePath: 'src/services/payment.ts',
				search: `const result = await stripe.charges.create({
  amount: order.total,
  currency: 'usd',
  source: token,
});
return result;`,
				replace: `try {
  const result = await stripe.charges.create({
    amount: order.total,
    currency: 'usd',
    source: token,
  });
  return result;
} catch (error) {
  logger.error('Payment failed', { orderId: order.id, error });
  throw new PaymentError('Failed to process payment', { cause: error });
}`,
			},
			output: `path=src/services/payment.ts status=success strategy=exact

=== Edit (lines 24-29) ===
--- BEFORE ---
  21 | async function processPayment(order: Order, token: string) {
  22 |   validateOrder(order);
  23 |
< 24 |   const result = await stripe.charges.create({
< 25 |     amount: order.total,
< 26 |     currency: 'usd',
< 27 |     source: token,
< 28 |   });
< 29 |   return result;
  30 | }

--- AFTER ---
  21 | async function processPayment(order: Order, token: string) {
  22 |   validateOrder(order);
  23 |
> 24 |   try {
> 25 |     const result = await stripe.charges.create({
> 26 |       amount: order.total,
> 27 |       currency: 'usd',
> 28 |       source: token,
> 29 |     });
> 30 |     return result;
> 31 |   } catch (error) {
> 32 |     logger.error('Payment failed', { orderId: order.id, error });
> 33 |     throw new PaymentError('Failed to process payment', { cause: error });
> 34 |   }
  35 | }

✓ No issues`,
			comment: 'Wrap existing code with try-catch error handling',
		},
		// Example 4: Non-TypeScript file (no diagnostics)
		{
			params: {
				comment: 'Enabling feature flag for new functionality',
				filePath: 'src/data.json',
				search: '"enabled": false',
				replace: '"enabled": true',
			},
			output: `path=src/data.json status=success strategy=exact

=== Edit (lines 3-3) ===
--- BEFORE ---
   1 | {
   2 |   "name": "example",
<  3 |   "enabled": false,
   4 |   "count": 0
   5 | }

--- AFTER ---
   1 | {
   2 |   "name": "example",
>  3 |   "enabled": true,
   4 |   "count": 0
   5 | }`,
			comment: 'Non-TypeScript file (no diagnostics appended)',
		},
		// Example 5: replaceAll for removing duplicates
		{
			params: {
				comment: 'Removing duplicate method definitions',
				filePath: 'src/store.ts',
				search: 'public duplicateMethod() { return 42; }',
				replace: '',
				replaceAll: true,
			},
			output: `path=src/store.ts status=success matches=3 strategy=exact

Replaced 3 occurrences (replaceAll=true).
Lines affected: 5-5, 12-12, 19-19

All matches deleted.`,
			comment:
				'Use replaceAll=true to replace all matches (for bulk renames or removing duplicates)',
		},
	],
}) {
	override execute(params: this['params']): string {
		const { filePath, search, replace, replaceAll = false } = params;

		// Validate and resolve path
		const validatedPath = validatePath(filePath);

		// Read file content
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

		// Find ALL matches using layered strategies
		const matches = findAllMatches(content, search);

		if (matches.length === 0) {
			// No match found - throw with helpful suggestions
			const failure = getMatchFailure(content, search);
			throw new Error(this.formatFailure(filePath, search, failure));
		}

		if (matches.length > 1 && !replaceAll) {
			// Multiple matches found - require explicit opt-in or more specific search
			throw new Error(this.formatMultipleMatchesError(filePath, matches, content));
		}

		// If replaceAll=true OR single match, proceed with replacement
		if (replaceAll && matches.length > 1) {
			return this.executeReplaceAll(filePath, validatedPath, content, matches, replace);
		}

		// Single match found - proceed with replacement
		const match = matches[0];

		// Store original content for before/after display
		const originalLines = content.split('\n');
		const beforeContext = formatContext(originalLines, match.startLine, match.endLine, 5, '<');

		// Apply replacement
		const newContent = applyReplacement(content, match, replace);

		// Write file
		writeFileSync(validatedPath, newContent, 'utf-8');
		invalidateFileRead(validatedPath);

		// Build and return success output
		return this.buildOutput(filePath, validatedPath, match, beforeContext, replace, newContent);
	}

	private buildOutput(
		filePath: string,
		validatedPath: string,
		match: {
			startLine: number;
			endLine: number;
			strategy: string;
		},
		beforeContext: string,
		replace: string,
		newContent: string,
	): string {
		// Check diagnostics and update state tracker
		const diagnosticResult = runDiagnosticsWithTracking(filePath, validatedPath);
		const status = diagnosticResult?.hasErrors ? 'error' : 'success';

		const newLines = newContent.split('\n');
		const replacementLineCount = replace.split('\n').length;
		const afterEndLine = match.startLine + replacementLineCount - 1;

		const output: string[] = [
			`path=${filePath} status=${status} strategy=${match.strategy}`,
			'',
			`=== Edit (lines ${match.startLine}-${match.endLine}) ===`,
			'--- BEFORE ---',
			beforeContext,
			'',
			'--- AFTER ---',
			formatContext(newLines, match.startLine, afterEndLine, 5),
		];

		if (diagnosticResult) {
			output.push('', diagnosticResult.statusMessage);
		}

		return output.join('\n');
	}

	private formatFailure(
		filePath: string,
		search: string,
		failure: {
			reason: string;
			suggestions: Array<{
				content: string;
				lineNumber: number;
				similarity: number;
			}>;
			nearbyContext: string;
		},
	): string {
		const searchLineCount = search.split('\n').length;
		const lines: string[] = [
			`ERROR: Search content NOT FOUND in file ${filePath}`,
			'',
			'Your search:',
			'```',
			search,
			'```',
		];

		if (failure.suggestions.length > 0) {
			lines.push('', 'SIMILAR CONTENT FOUND (did you mean one of these?):');
			for (const suggestion of failure.suggestions) {
				const percent = Math.round(suggestion.similarity * 100);
				const endLine = suggestion.lineNumber + searchLineCount - 1;
				const lineRange =
					searchLineCount > 1
						? `lines ${suggestion.lineNumber}-${endLine}`
						: `line ${suggestion.lineNumber}`;
				lines.push(
					'',
					`--- ${lineRange} (${percent}% match) ---`,
					'```',
					suggestion.content,
					'```',
				);
			}

			lines.push(
				'',
				'TIP: If your search content was modified, re-read the file to get the current content.',
			);
		} else {
			lines.push(
				'',
				'No similar content found. The search content may have been deleted or significantly changed.',
				'',
				'TIP: Re-read the file to see its current content.',
			);
		}

		return lines.join('\n');
	}

	private formatMultipleMatchesError(
		filePath: string,
		matches: Array<{
			startLine: number;
			endLine: number;
		}>,
		content: string,
	): string {
		const lines = content.split('\n');
		const output: string[] = [
			`ERROR: Ambiguous search - found ${matches.length} matches in ${filePath}`,
			'',
			'Options:',
			'1. Add more surrounding context to uniquely identify the target location',
			'2. Use replaceAll=true to replace ALL occurrences',
			'',
			'Matches found at:',
		];

		// Show context for each match (max 5 matches to avoid huge output)
		const matchesToShow = matches.slice(0, 5);
		for (let i = 0; i < matchesToShow.length; i++) {
			const match = matchesToShow[i];
			output.push(
				'',
				`--- Match ${i + 1} at lines ${match.startLine}-${match.endLine} ---`,
				formatContext(lines, match.startLine, match.endLine, 2, '>'),
			);
		}

		if (matches.length > 5) {
			output.push('', `... and ${matches.length - 5} more matches`);
		}

		return output.join('\n');
	}

	private executeReplaceAll(
		filePath: string,
		validatedPath: string,
		content: string,
		matches: MatchResult[],
		replace: string,
	): string {
		// Apply replacements in reverse order to preserve indices
		let newContent = content;
		const sortedMatches = [...matches].sort((a, b) => b.startIndex - a.startIndex);

		for (const match of sortedMatches) {
			newContent = applyReplacement(newContent, match, replace);
		}

		// Write file
		writeFileSync(validatedPath, newContent, 'utf-8');
		invalidateFileRead(validatedPath);

		// Build output for replaceAll
		return this.buildReplaceAllOutput(filePath, validatedPath, matches, replace);
	}

	private buildReplaceAllOutput(
		filePath: string,
		validatedPath: string,
		matches: MatchResult[],
		replace: string,
	): string {
		// Check diagnostics and update state tracker
		const diagnosticResult = runDiagnosticsWithTracking(filePath, validatedPath);
		const status = diagnosticResult?.hasErrors ? 'error' : 'success';

		const strategy = matches[0].strategy;
		const lineRanges = matches.map((m) => `${m.startLine}-${m.endLine}`).join(', ');

		const output: string[] = [
			`path=${filePath} status=${status} matches=${matches.length} strategy=${strategy}`,
			'',
			`Replaced ${matches.length} occurrences (replaceAll=true).`,
			`Lines affected: ${lineRanges}`,
		];

		if (replace === '') {
			output.push('', 'All matches deleted.');
		}

		if (diagnosticResult) {
			output.push('', diagnosticResult.statusMessage);
		}

		return output.join('\n');
	}
}

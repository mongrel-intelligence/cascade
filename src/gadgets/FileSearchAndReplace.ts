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
	runDiagnostics,
	shouldRunDiagnostics,
	validatePath,
} from './shared/index.js';

export class FileSearchAndReplace extends Gadget({
	name: 'FileSearchAndReplace',
	description: `Search for content in a file and replace it.

Uses layered matching: exact → whitespace → indentation → fuzzy
This reduces edit errors by ~9x.

All occurrences of the search content are replaced.`,
	timeoutMs: 30000,
	maxConcurrent: 1, // Sequential execution to prevent race conditions on file writes
	schema: z.object({
		comment: z.string().min(1).describe('Brief rationale for this gadget call'),
		filePath: z.string().describe('Path to the file to edit'),
		search: z.string().min(1).describe('The content to search for'),
		replace: z.string().describe('The content to replace with (empty to delete)'),
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
			output: `path=src/config.ts status=success matches=1 strategy=exact

Replaced 1 occurrence.

=== Edit 1 (lines 5-5) ===
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

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Single edit with before/after context and diagnostics',
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
			output: `path=src/api/users.ts status=success matches=1 strategy=exact

Replaced 1 occurrence.

=== Edit 1 (lines 12-15) ===
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

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
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
			output: `path=src/services/payment.ts status=success matches=1 strategy=exact

Replaced 1 occurrence.

=== Edit 1 (lines 24-29) ===
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

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Wrap existing code with try-catch error handling',
		},
		// Example 4: Multiple occurrences
		{
			params: {
				comment: 'Updating retry constant per requirements',
				filePath: 'src/constants.ts',
				search: 'MAX_RETRIES = 3',
				replace: 'MAX_RETRIES = 5',
			},
			output: `path=src/constants.ts status=success matches=2 strategy=exact

Replaced 2 occurrences.

=== Edit 1 (lines 4-4) ===
--- BEFORE ---
   1 | // API constants
   2 | export const API_URL = "https://api.example.com";
   3 |
<  4 | export const MAX_RETRIES = 3;
   5 | export const TIMEOUT = 5000;

--- AFTER ---
   1 | // API constants
   2 | export const API_URL = "https://api.example.com";
   3 |
>  4 | export const MAX_RETRIES = 5;
   5 | export const TIMEOUT = 5000;

=== Edit 2 (lines 12-12) ===
--- BEFORE ---
   9 | // Client constants
  10 | export const CLIENT_URL = "https://client.example.com";
  11 |
< 12 | export const MAX_RETRIES = 3;
  13 | export const CLIENT_TIMEOUT = 3000;

--- AFTER ---
   9 | // Client constants
  10 | export const CLIENT_URL = "https://client.example.com";
  11 |
> 12 | export const MAX_RETRIES = 5;
  13 | export const CLIENT_TIMEOUT = 3000;

=== TypeScript Check ===
No type errors found.

=== Biome Lint ===
No lint issues found.`,
			comment: 'Multiple matches replaced with before/after for each',
		},
		// Example 5: Non-TypeScript file (no diagnostics)
		{
			params: {
				comment: 'Enabling feature flag for new functionality',
				filePath: 'src/data.json',
				search: '"enabled": false',
				replace: '"enabled": true',
			},
			output: `path=src/data.json status=success matches=1 strategy=exact

Replaced 1 occurrence.

=== Edit 1 (lines 3-3) ===
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
	],
}) {
	override execute(params: this['params']): string {
		const { filePath, search, replace } = params;

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

		// Store original content for before/after display
		const originalLines = content.split('\n');

		// Collect before contexts BEFORE applying any replacements
		const beforeContexts: Array<{
			startLine: number;
			endLine: number;
			context: string;
		}> = [];
		for (const match of matches) {
			beforeContexts.push({
				startLine: match.startLine,
				endLine: match.endLine,
				context: formatContext(originalLines, match.startLine, match.endLine, 5, '<'),
			});
		}

		// Apply replacements in reverse order (to preserve indices)
		let newContent = content;
		const sortedMatches = [...matches].sort((a, b) => b.startIndex - a.startIndex);
		for (const match of sortedMatches) {
			newContent = applyReplacement(newContent, match, replace);
		}

		// Write file
		writeFileSync(validatedPath, newContent, 'utf-8');
		invalidateFileRead(validatedPath);

		// Build and return success output
		return this.buildOutput(filePath, validatedPath, matches, beforeContexts, replace, newContent);
	}

	private buildOutput(
		filePath: string,
		validatedPath: string,
		matches: Array<{
			startLine: number;
			endLine: number;
			strategy: string;
		}>,
		beforeContexts: Array<{
			startLine: number;
			endLine: number;
			context: string;
		}>,
		replace: string,
		newContent: string,
	): string {
		const newLines = newContent.split('\n');
		const output: string[] = [
			`path=${filePath} status=success matches=${matches.length} strategy=${matches[0].strategy}`,
			'',
			`Replaced ${matches.length} occurrence${matches.length > 1 ? 's' : ''}.`,
		];

		const replacementLineCount = replace.split('\n').length;
		let cumulativeLineDelta = 0;

		for (let i = 0; i < matches.length; i++) {
			const match = matches[i];
			const matchedLineCount = match.endLine - match.startLine + 1;
			const lineDelta = replacementLineCount - matchedLineCount;
			const afterStartLine = match.startLine + cumulativeLineDelta;
			const afterEndLine = afterStartLine + replacementLineCount - 1;

			output.push(
				'',
				`=== Edit ${i + 1} (lines ${match.startLine}-${match.endLine}) ===`,
				'--- BEFORE ---',
				beforeContexts[i].context,
				'',
				'--- AFTER ---',
				formatContext(newLines, afterStartLine, afterEndLine, 5),
			);

			cumulativeLineDelta += lineDelta;
		}

		if (shouldRunDiagnostics(filePath)) {
			output.push('', runDiagnostics(validatedPath));
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
		const lines: string[] = [
			`ERROR: Search content NOT FOUND in file ${filePath}`,
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

		return lines.join('\n');
	}
}

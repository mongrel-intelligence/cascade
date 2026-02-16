/**
 * Layered matching algorithm for file editing gadgets.
 *
 * Tries strategies in order: exact → whitespace → indentation → fuzzy → dmp
 * This approach reduces edit errors by ~9x (per Aider benchmarks).
 */

import type {
	MatchFailure,
	MatchOptions,
	MatchResult,
	MatchStrategy,
	SuggestionMatch,
} from '../types.js';
import {
	dmpMatch,
	exactMatch,
	fuzzyMatch,
	indentationMatch,
	whitespaceMatch,
} from './strategies/index.js';
import { calculateLineSimilarity, getContext } from './utils.js';

const DEFAULT_OPTIONS: Required<MatchOptions> = {
	fuzzyThreshold: 0.8,
	maxSuggestions: 3,
	contextLines: 5,
};

/**
 * Find a match for the search string in content using layered strategies.
 *
 * @param content The file content to search in
 * @param search The string to search for
 * @param options Matching options
 * @returns MatchResult if found, null if not found
 */
export function findMatch(
	content: string,
	search: string,
	options: MatchOptions = {},
): MatchResult | null {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	// Try each strategy in order
	const strategies: Array<{
		name: MatchStrategy;
		fn: (content: string, search: string) => MatchResult | null;
	}> = [
		{ name: 'exact', fn: exactMatch },
		{ name: 'whitespace', fn: whitespaceMatch },
		{ name: 'indentation', fn: indentationMatch },
		{ name: 'fuzzy', fn: (c, s) => fuzzyMatch(c, s, opts.fuzzyThreshold) },
		{ name: 'dmp', fn: (c, s) => dmpMatch(c, s, opts.fuzzyThreshold) },
	];

	for (const { name, fn } of strategies) {
		const result = fn(content, search);
		if (result) {
			return { ...result, strategy: name };
		}
	}

	return null;
}

/**
 * Find ALL matches for the search string in content.
 * Returns matches in order of appearance (for sequential replacement).
 *
 * @param content The file content to search in
 * @param search The string to search for
 * @param options Matching options
 * @returns Array of MatchResult objects (may be empty if no matches)
 */
export function findAllMatches(
	content: string,
	search: string,
	options: MatchOptions = {},
): MatchResult[] {
	const matches: MatchResult[] = [];
	let remaining = content;
	let offset = 0;

	while (true) {
		const match = findMatch(remaining, search, options);
		if (!match) break;

		// Count newlines in the skipped portion to adjust line numbers
		const skippedContent = content.slice(0, offset);
		const lineOffset = countNewlines(skippedContent);

		// Adjust indices to account for offset
		matches.push({
			...match,
			startIndex: match.startIndex + offset,
			endIndex: match.endIndex + offset,
			startLine: match.startLine + lineOffset,
			endLine: match.endLine + lineOffset,
		});

		// Move past this match
		offset += match.endIndex;
		remaining = content.slice(offset);
	}

	return matches;
}

/**
 * Count newlines in a string.
 */
function countNewlines(s: string): number {
	return (s.match(/\n/g) || []).length;
}

/**
 * Apply replacement to content at the matched location.
 */
export function applyReplacement(content: string, match: MatchResult, replacement: string): string {
	return content.slice(0, match.startIndex) + replacement + content.slice(match.endIndex);
}

/**
 * Get failure details with suggestions when no match is found.
 */
export function getMatchFailure(
	content: string,
	search: string,
	options: MatchOptions = {},
): MatchFailure {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const suggestions = findSuggestions(content, search, opts.maxSuggestions, opts.fuzzyThreshold);
	const nearbyContext =
		suggestions.length > 0 ? getContext(content, suggestions[0].lineNumber, opts.contextLines) : '';

	return {
		reason: 'Search content not found in file',
		suggestions,
		nearbyContext,
	};
}

/**
 * Find suggestions for when a match fails.
 */
function findSuggestions(
	content: string,
	search: string,
	maxSuggestions: number,
	minSimilarity: number,
): SuggestionMatch[] {
	const searchLines = search.split('\n');
	const contentLines = content.split('\n');
	const suggestions: Array<{ lineIndex: number; similarity: number; content: string }> = [];

	// Reduce threshold for suggestions (show more potential matches)
	const suggestionThreshold = Math.max(0.5, minSimilarity - 0.2);

	// Find best matches using sliding window
	for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
		const windowLines = contentLines.slice(i, i + searchLines.length);
		const similarity = calculateLineSimilarity(searchLines, windowLines);

		if (similarity >= suggestionThreshold) {
			suggestions.push({
				lineIndex: i,
				similarity,
				content: windowLines.join('\n'),
			});
		}
	}

	// Sort by similarity descending
	suggestions.sort((a, b) => b.similarity - a.similarity);

	return suggestions.slice(0, maxSuggestions).map((s) => ({
		content: s.content,
		lineNumber: s.lineIndex + 1, // 1-based
		similarity: s.similarity,
	}));
}

/**
 * Apply indentation delta to a replacement string.
 * Prepends the delta to each non-empty line.
 */
export function adjustIndentation(replacement: string, delta: string): string {
	return replacement
		.split('\n')
		.map((line) => (line.trim().length > 0 ? delta + line : line))
		.join('\n');
}

/**
 * Format context lines around an edited range for output display.
 */
export function formatContext(
	lines: string[],
	startLine: number,
	endLine: number,
	contextLines = 5,
	editMarker = '>',
): string {
	const rangeStart = Math.max(0, startLine - 1 - contextLines);
	const rangeEnd = Math.min(lines.length, endLine + contextLines);

	const result: string[] = [];
	for (let i = rangeStart; i < rangeEnd; i++) {
		const lineNum = i + 1;
		const isEdited = lineNum >= startLine && lineNum <= endLine;
		const marker = isEdited ? editMarker : ' ';
		const paddedNum = String(lineNum).padStart(4);
		result.push(`${marker}${paddedNum} | ${lines[i]}`);
	}

	return result.join('\n');
}

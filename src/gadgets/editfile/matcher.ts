/**
 * Layered matching algorithm for EditFile gadget.
 *
 * Tries strategies in order: exact → whitespace → indentation → fuzzy
 * This approach reduces edit errors by ~9x (per Aider benchmarks).
 */

import type {
	MatchFailure,
	MatchOptions,
	MatchResult,
	MatchStrategy,
	SuggestionMatch,
} from './types.js';

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

// ============================================================================
// Strategy 1: Exact Match
// ============================================================================

function exactMatch(content: string, search: string): MatchResult | null {
	const index = content.indexOf(search);
	if (index === -1) return null;

	const { startLine, endLine } = getLineNumbers(content, index, index + search.length);

	return {
		found: true,
		strategy: 'exact',
		confidence: 1.0,
		matchedContent: search,
		startIndex: index,
		endIndex: index + search.length,
		startLine,
		endLine,
	};
}

// ============================================================================
// Strategy 2: Whitespace-Insensitive Match
// ============================================================================

function whitespaceMatch(content: string, search: string): MatchResult | null {
	// Normalize runs of spaces/tabs to single space, preserve newlines
	const normalizeWs = (s: string) => s.replace(/[ \t]+/g, ' ');

	const normalizedContent = normalizeWs(content);
	const normalizedSearch = normalizeWs(search);

	const normalizedIndex = normalizedContent.indexOf(normalizedSearch);
	if (normalizedIndex === -1) return null;

	// Map normalized index back to original content
	const { originalStart, originalEnd } = mapNormalizedToOriginal(
		content,
		normalizedIndex,
		normalizedSearch.length,
	);

	const matchedContent = content.slice(originalStart, originalEnd);
	const { startLine, endLine } = getLineNumbers(content, originalStart, originalEnd);

	return {
		found: true,
		strategy: 'whitespace',
		confidence: 0.95,
		matchedContent,
		startIndex: originalStart,
		endIndex: originalEnd,
		startLine,
		endLine,
	};
}

// ============================================================================
// Strategy 3: Indentation-Preserving Match
// ============================================================================

function indentationMatch(content: string, search: string): MatchResult | null {
	// Strip leading whitespace from each line for comparison
	const stripIndent = (s: string) =>
		s
			.split('\n')
			.map((line) => line.trimStart())
			.join('\n');

	const strippedSearch = stripIndent(search);
	const contentLines = content.split('\n');

	// Sliding window search
	const searchLineCount = search.split('\n').length;

	for (let i = 0; i <= contentLines.length - searchLineCount; i++) {
		const windowLines = contentLines.slice(i, i + searchLineCount);
		const strippedWindow = stripIndent(windowLines.join('\n'));

		if (strippedWindow === strippedSearch) {
			// Found match - calculate original indices
			const startIndex = contentLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
			const matchedContent = windowLines.join('\n');
			const endIndex = startIndex + matchedContent.length;
			const { startLine, endLine } = getLineNumbers(content, startIndex, endIndex);

			return {
				found: true,
				strategy: 'indentation',
				confidence: 0.9,
				matchedContent,
				startIndex,
				endIndex,
				startLine,
				endLine,
			};
		}
	}

	return null;
}

// ============================================================================
// Strategy 4: Fuzzy Match
// ============================================================================

function fuzzyMatch(content: string, search: string, threshold: number): MatchResult | null {
	const searchLines = search.split('\n');
	const contentLines = content.split('\n');

	if (searchLines.length > contentLines.length) return null;

	let bestMatch: {
		startLineIndex: number;
		endLineIndex: number;
		similarity: number;
	} | null = null;

	// Sliding window
	for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
		const windowLines = contentLines.slice(i, i + searchLines.length);
		const similarity = calculateLineSimilarity(searchLines, windowLines);

		if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
			bestMatch = {
				startLineIndex: i,
				endLineIndex: i + searchLines.length,
				similarity,
			};
		}
	}

	if (!bestMatch) return null;

	// Calculate original indices
	const startIndex =
		contentLines.slice(0, bestMatch.startLineIndex).join('\n').length +
		(bestMatch.startLineIndex > 0 ? 1 : 0);
	const matchedContent = contentLines
		.slice(bestMatch.startLineIndex, bestMatch.endLineIndex)
		.join('\n');
	const endIndex = startIndex + matchedContent.length;
	const { startLine, endLine } = getLineNumbers(content, startIndex, endIndex);

	return {
		found: true,
		strategy: 'fuzzy',
		confidence: bestMatch.similarity,
		matchedContent,
		startIndex,
		endIndex,
		startLine,
		endLine,
	};
}

// ============================================================================
// Suggestion Finding
// ============================================================================

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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate similarity between two line arrays using line-by-line comparison.
 */
function calculateLineSimilarity(a: string[], b: string[]): number {
	if (a.length !== b.length) return 0;
	if (a.length === 0) return 1;

	let totalSimilarity = 0;
	let totalWeight = 0;

	for (let i = 0; i < a.length; i++) {
		const lineA = a[i];
		const lineB = b[i];
		// Weight by line length (longer lines matter more)
		const weight = Math.max(lineA.length, lineB.length, 1);
		const similarity = stringSimilarity(lineA, lineB);
		totalSimilarity += similarity * weight;
		totalWeight += weight;
	}

	return totalWeight > 0 ? totalSimilarity / totalWeight : 0;
}

/**
 * Calculate similarity between two strings using Levenshtein distance.
 */
function stringSimilarity(a: string, b: string): number {
	if (a === b) return 1;
	if (a.length === 0 || b.length === 0) return 0;

	const distance = levenshteinDistance(a, b);
	const maxLen = Math.max(a.length, b.length);
	return 1 - distance / maxLen;
}

/**
 * Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
	const matrix: number[][] = [];

	for (let i = 0; i <= b.length; i++) {
		matrix[i] = [i];
	}
	for (let j = 0; j <= a.length; j++) {
		matrix[0][j] = j;
	}

	for (let i = 1; i <= b.length; i++) {
		for (let j = 1; j <= a.length; j++) {
			if (b.charAt(i - 1) === a.charAt(j - 1)) {
				matrix[i][j] = matrix[i - 1][j - 1];
			} else {
				matrix[i][j] = Math.min(
					matrix[i - 1][j - 1] + 1, // substitution
					matrix[i][j - 1] + 1, // insertion
					matrix[i - 1][j] + 1, // deletion
				);
			}
		}
	}

	return matrix[b.length][a.length];
}

/**
 * Get 1-based line numbers for a range in content.
 */
function getLineNumbers(
	content: string,
	startIndex: number,
	endIndex: number,
): { startLine: number; endLine: number } {
	const beforeStart = content.slice(0, startIndex);
	const beforeEnd = content.slice(0, endIndex);

	const startLine = (beforeStart.match(/\n/g) || []).length + 1;
	const endLine = (beforeEnd.match(/\n/g) || []).length + 1;

	return { startLine, endLine };
}

/**
 * Check if character is horizontal whitespace (space or tab).
 */
function isHorizontalWhitespace(char: string): boolean {
	return char === ' ' || char === '\t';
}

/**
 * Map normalized string index back to original string.
 * Uses a two-pass approach: first find start, then find end.
 */
function mapNormalizedToOriginal(
	original: string,
	normalizedStart: number,
	normalizedLength: number,
): { originalStart: number; originalEnd: number } {
	const originalStart = findOriginalIndex(original, normalizedStart);
	const originalEnd = findOriginalIndex(original, normalizedStart + normalizedLength);
	return { originalStart, originalEnd: originalEnd === -1 ? original.length : originalEnd };
}

/**
 * Find original string index for a given normalized position.
 */
function findOriginalIndex(original: string, targetNormalizedPos: number): number {
	let normalizedPos = 0;
	let inWhitespace = false;

	for (let i = 0; i < original.length; i++) {
		if (normalizedPos === targetNormalizedPos) {
			return i;
		}

		const isWs = isHorizontalWhitespace(original[i]);
		if (isWs && !inWhitespace) {
			normalizedPos++;
			inWhitespace = true;
		} else if (!isWs) {
			normalizedPos++;
			inWhitespace = false;
		}
	}

	return normalizedPos === targetNormalizedPos ? original.length : -1;
}

/**
 * Get context lines around a line number.
 */
function getContext(content: string, lineNumber: number, contextLines: number): string {
	const lines = content.split('\n');
	const start = Math.max(0, lineNumber - 1 - contextLines);
	const end = Math.min(lines.length, lineNumber + contextLines);

	const contextWithNumbers = lines.slice(start, end).map((line, i) => {
		const num = start + i + 1;
		const marker = num === lineNumber ? '>' : ' ';
		return `${marker}${String(num).padStart(4)} | ${line}`;
	});

	return contextWithNumbers.join('\n');
}

/**
 * Utility functions for the matcher strategies.
 */

/**
 * Get 1-based line numbers for a range in content.
 */
export function getLineNumbers(
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
 * Map normalized string index back to original string.
 * Uses a two-pass approach: first find start, then find end.
 */
export function mapNormalizedToOriginal(
	original: string,
	normalizedStart: number,
	normalizedLength: number,
): { originalStart: number; originalEnd: number } {
	const originalStart = findOriginalIndex(original, normalizedStart);
	const originalEnd = findOriginalIndex(original, normalizedStart + normalizedLength);
	return { originalStart, originalEnd: originalEnd === -1 ? original.length : originalEnd };
}

/**
 * Get the leading whitespace of the first non-empty line.
 */
function getLeadingWhitespace(lines: string[]): string | null {
	for (const line of lines) {
		if (line.trim().length > 0) {
			return line.slice(0, line.length - line.trimStart().length);
		}
	}
	return null;
}

/**
 * Compute the indentation delta between matched content and search string.
 * Returns the whitespace prefix to prepend to each replacement line.
 */
export function computeIndentationDelta(
	contentLines: string[],
	searchLines: string[],
): string | undefined {
	// Find first non-empty line in both to determine indentation levels
	const contentIndent = getLeadingWhitespace(contentLines);
	const searchIndent = getLeadingWhitespace(searchLines);

	if (contentIndent === null || contentIndent === searchIndent) {
		return undefined; // No delta needed
	}

	// Delta is what we need to add to search indentation to reach content indentation
	if (searchIndent === null || searchIndent === '') {
		return contentIndent;
	}

	// If search has some indentation, compute the difference
	if (contentIndent.startsWith(searchIndent)) {
		return contentIndent.slice(searchIndent.length);
	}

	// Different indentation styles or search is more indented — return full content indent
	return contentIndent;
}

/**
 * Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
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
 * Calculate similarity between two line arrays using line-by-line comparison.
 */
export function calculateLineSimilarity(a: string[], b: string[]): number {
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
 * Get context lines around a line number.
 */
export function getContext(content: string, lineNumber: number, contextLines: number): string {
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

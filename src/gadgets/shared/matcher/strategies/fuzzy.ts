import type { MatchResult } from '../../types.js';
import { calculateLineSimilarity, getLineNumbers } from '../utils.js';

/**
 * Strategy 4: Fuzzy Match
 * Uses line-by-line similarity comparison with a sliding window.
 */
export function fuzzyMatch(content: string, search: string, threshold: number): MatchResult | null {
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

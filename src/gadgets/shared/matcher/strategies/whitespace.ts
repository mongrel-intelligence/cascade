import type { MatchResult } from '../../types.js';
import { getLineNumbers, mapNormalizedToOriginal } from '../utils.js';

/**
 * Strategy 2: Whitespace-Insensitive Match
 * Normalizes runs of spaces/tabs to single space, preserves newlines.
 */
export function whitespaceMatch(content: string, search: string): MatchResult | null {
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

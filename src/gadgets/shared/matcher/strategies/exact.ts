import type { MatchResult } from '../../types.js';
import { getLineNumbers } from '../utils.js';

/**
 * Strategy 1: Exact Match
 * Find an exact substring match.
 */
export function exactMatch(content: string, search: string): MatchResult | null {
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

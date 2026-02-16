import type { MatchResult } from '../../types.js';
import { computeIndentationDelta, getLineNumbers } from '../utils.js';

/**
 * Strategy 3: Indentation-Preserving Match
 * Strips leading whitespace from each line for comparison.
 */
export function indentationMatch(content: string, search: string): MatchResult | null {
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

			// Compute indentation delta between file content and search string
			const indentationDelta = computeIndentationDelta(windowLines, search.split('\n'));

			return {
				found: true,
				strategy: 'indentation',
				confidence: 0.9,
				matchedContent,
				startIndex,
				endIndex,
				startLine,
				endLine,
				indentationDelta,
			};
		}
	}

	return null;
}

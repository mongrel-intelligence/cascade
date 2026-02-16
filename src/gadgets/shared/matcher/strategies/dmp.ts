import DiffMatchPatch from 'diff-match-patch';

import type { MatchResult } from '../../types.js';
import { getLineNumbers, levenshteinDistance } from '../utils.js';

/**
 * DMP match for short patterns (<= 32 chars) using native bitap algorithm.
 */
function dmpMatchShortPattern(content: string, search: string, threshold: number): number {
	const dmp = new DiffMatchPatch();
	dmp.Match_Threshold = 1.0 - threshold;
	dmp.Match_Distance = 100000;
	try {
		return dmp.match_main(content, search, 0);
	} catch {
		return -1;
	}
}

/**
 * DMP match for long patterns (> 32 chars). Uses DMP on a 32-char prefix
 * to find the approximate region, then verifies full match with Levenshtein.
 */
function dmpMatchLongPattern(content: string, search: string, threshold: number): number {
	const dmp = new DiffMatchPatch();
	dmp.Match_Threshold = 1.0 - threshold;
	dmp.Match_Distance = 100000;

	let approxIndex: number;
	try {
		approxIndex = dmp.match_main(content, search.substring(0, 32), 0);
	} catch {
		return -1;
	}
	if (approxIndex === -1) return -1;

	// Verify full match around the approximate position using Levenshtein
	const regionStart = Math.max(0, approxIndex - 10);
	const regionEnd = Math.min(content.length, approxIndex + search.length + 10);
	const region = content.substring(regionStart, regionEnd);

	let bestIndex = -1;
	let bestSimilarity = 0;

	for (let i = 0; i <= region.length - search.length; i++) {
		const candidate = region.substring(i, i + search.length);
		const sim =
			1.0 - levenshteinDistance(candidate, search) / Math.max(candidate.length, search.length);
		if (sim > bestSimilarity) {
			bestSimilarity = sim;
			bestIndex = regionStart + i;
		}
	}

	return bestSimilarity >= threshold ? bestIndex : -1;
}

/**
 * Strategy 5: DMP Match (diff-match-patch)
 * Uses Google's diff-match-patch library for character-level fuzzy matching.
 * This is more robust than Levenshtein for code that has been refactored.
 */
export function dmpMatch(content: string, search: string, threshold: number): MatchResult | null {
	// Skip DMP for very long patterns where it becomes too slow
	if (search.length > 1000) return null;

	const matchIndex =
		search.length > 32
			? dmpMatchLongPattern(content, search, threshold)
			: dmpMatchShortPattern(content, search, threshold);

	if (matchIndex === -1) return null;

	// Extract the matched region and calculate similarity
	const matchedContent = content.substring(matchIndex, matchIndex + search.length);
	const similarity =
		1.0 -
		levenshteinDistance(matchedContent, search) / Math.max(matchedContent.length, search.length);

	// Only accept if it meets our threshold
	if (similarity < threshold) return null;

	const startIndex = matchIndex;
	const endIndex = matchIndex + search.length;
	const { startLine, endLine } = getLineNumbers(content, startIndex, endIndex);

	return {
		found: true,
		strategy: 'dmp',
		confidence: similarity,
		matchedContent,
		startIndex,
		endIndex,
		startLine,
		endLine,
	};
}

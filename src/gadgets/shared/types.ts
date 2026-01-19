/**
 * Types for the file editing gadgets' layered matching algorithm.
 */

/**
 * Strategy used to find a match.
 */
export type MatchStrategy = 'exact' | 'whitespace' | 'indentation' | 'fuzzy' | 'dmp';

/**
 * Result of attempting to find a match.
 */
export interface MatchResult {
	/** Whether a match was found */
	found: boolean;
	/** Strategy that succeeded */
	strategy: MatchStrategy;
	/** Confidence score 0.0 - 1.0 */
	confidence: number;
	/** The actual content that was matched */
	matchedContent: string;
	/** Start index in the content string */
	startIndex: number;
	/** End index in the content string (exclusive) */
	endIndex: number;
	/** 1-based start line number for display */
	startLine: number;
	/** 1-based end line number for display */
	endLine: number;
}

/**
 * A suggested match when the search fails.
 */
export interface SuggestionMatch {
	/** The content that was found */
	content: string;
	/** 1-based line number for display */
	lineNumber: number;
	/** Similarity score 0.0 - 1.0 */
	similarity: number;
}

/**
 * Options for the matching operation.
 */
export interface MatchOptions {
	/** Minimum similarity for fuzzy matching (0.0 - 1.0). Default: 0.8 */
	fuzzyThreshold?: number;
	/** Maximum number of suggestions to return on failure. Default: 3 */
	maxSuggestions?: number;
	/** Number of context lines to show around suggestions. Default: 5 */
	contextLines?: number;
}

/**
 * Result of a failed match with suggestions.
 */
export interface MatchFailure {
	/** Reason the match failed */
	reason: string;
	/** Suggested similar content that might be what the user meant */
	suggestions: SuggestionMatch[];
	/** Context around the best suggestion */
	nearbyContext: string;
}

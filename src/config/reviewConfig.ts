/**
 * Maximum estimated tokens for synthetic file content injection.
 * Files are injected until this limit is reached.
 * Remaining files are noted as "available on request".
 */
export const REVIEW_FILE_CONTENT_TOKEN_LIMIT = 25_000;

/**
 * Rough token estimation: ~4 characters per token.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

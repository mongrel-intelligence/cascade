import { describe, expect, it } from 'vitest';

import {
	REVIEW_FILE_CONTENT_TOKEN_LIMIT,
	estimateTokens,
} from '../../../src/config/reviewConfig.js';

describe.concurrent('config/reviewConfig', () => {
	describe('REVIEW_FILE_CONTENT_TOKEN_LIMIT', () => {
		it('is defined as a number', () => {
			expect(typeof REVIEW_FILE_CONTENT_TOKEN_LIMIT).toBe('number');
		});

		it('is set to 25000 tokens', () => {
			expect(REVIEW_FILE_CONTENT_TOKEN_LIMIT).toBe(25_000);
		});

		it('is a positive value', () => {
			expect(REVIEW_FILE_CONTENT_TOKEN_LIMIT).toBeGreaterThan(0);
		});
	});

	describe('estimateTokens', () => {
		it('estimates roughly 4 characters per token', () => {
			const text = 'a'.repeat(400);
			const tokens = estimateTokens(text);

			// 400 chars / 4 = 100 tokens
			expect(tokens).toBe(100);
		});

		it('returns correct estimate for short text', () => {
			const text = 'hello world'; // 11 chars
			const tokens = estimateTokens(text);

			// 11 / 4 = 2.75 -> ceil = 3
			expect(tokens).toBe(3);
		});

		it('returns correct estimate for longer text', () => {
			const text = 'a'.repeat(1000);
			const tokens = estimateTokens(text);

			// 1000 / 4 = 250
			expect(tokens).toBe(250);
		});

		it('rounds up using ceil', () => {
			const text = 'abc'; // 3 chars
			const tokens = estimateTokens(text);

			// 3 / 4 = 0.75 -> ceil = 1
			expect(tokens).toBe(1);
		});

		it('handles empty string', () => {
			const tokens = estimateTokens('');

			// 0 / 4 = 0 -> ceil = 0
			expect(tokens).toBe(0);
		});

		it('handles single character', () => {
			const tokens = estimateTokens('x');

			// 1 / 4 = 0.25 -> ceil = 1
			expect(tokens).toBe(1);
		});

		it('handles exact multiples of 4', () => {
			const text = 'a'.repeat(40);
			const tokens = estimateTokens(text);

			// 40 / 4 = 10 (exact)
			expect(tokens).toBe(10);
		});

		it('estimates tokens for realistic code snippet', () => {
			const codeSnippet = `
function greet(name: string): string {
	return \`Hello, \${name}!\`;
}
`.trim();

			const tokens = estimateTokens(codeSnippet);

			// Length is ~64 chars -> 64/4 = 16 tokens
			expect(tokens).toBeGreaterThan(10);
			expect(tokens).toBeLessThan(25);
		});

		it('estimates tokens for multiline text', () => {
			const text = `This is line 1
This is line 2
This is line 3`;

			const tokens = estimateTokens(text);

			// ~42 chars (including newlines) -> 42/4 = 10.5 -> ceil = 11
			expect(tokens).toBeGreaterThan(8);
			expect(tokens).toBeLessThan(15);
		});

		it('handles unicode characters as character length', () => {
			const text = '🔥'.repeat(100); // 100 emoji (each is 2 chars in JS)
			const tokens = estimateTokens(text);

			// In JS, emoji are typically 2 chars each -> 200 / 4 = 50 tokens
			expect(tokens).toBe(50);
		});

		it('returns consistent results for same input', () => {
			const text = 'The quick brown fox jumps over the lazy dog';

			const tokens1 = estimateTokens(text);
			const tokens2 = estimateTokens(text);

			expect(tokens1).toBe(tokens2);
		});

		it('larger text has proportionally more tokens', () => {
			const shortText = 'a'.repeat(100);
			const longText = 'a'.repeat(1000);

			const shortTokens = estimateTokens(shortText);
			const longTokens = estimateTokens(longText);

			expect(longTokens).toBe(shortTokens * 10);
		});

		it('approximates typical file within limit', () => {
			// A file with ~100k characters should be ~25k tokens
			const largeFile = 'x'.repeat(100_000);
			const tokens = estimateTokens(largeFile);

			expect(tokens).toBe(25_000);
			expect(tokens).toBe(REVIEW_FILE_CONTENT_TOKEN_LIMIT);
		});
	});

	describe('integration', () => {
		it('can use estimateTokens to check against limit', () => {
			const smallFile = 'a'.repeat(50_000); // ~12.5k tokens
			const largeFile = 'a'.repeat(150_000); // ~37.5k tokens

			expect(estimateTokens(smallFile)).toBeLessThan(REVIEW_FILE_CONTENT_TOKEN_LIMIT);
			expect(estimateTokens(largeFile)).toBeGreaterThan(REVIEW_FILE_CONTENT_TOKEN_LIMIT);
		});

		it('limit allows for reasonable amount of file content', () => {
			// 25k tokens * 4 chars = 100k characters
			// This is enough for ~3-5 medium TypeScript files
			const estimatedChars = REVIEW_FILE_CONTENT_TOKEN_LIMIT * 4;

			expect(estimatedChars).toBe(100_000);
			expect(estimatedChars).toBeGreaterThan(50_000); // Minimum reasonable
			expect(estimatedChars).toBeLessThan(200_000); // Maximum to avoid context overflow
		});
	});
});

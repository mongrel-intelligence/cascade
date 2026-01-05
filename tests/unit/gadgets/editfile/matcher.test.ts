import { describe, expect, it } from 'vitest';
import {
	applyReplacement,
	findMatch,
	getMatchFailure,
} from '../../../../src/gadgets/editfile/matcher.js';

describe('Matcher', () => {
	describe('findMatch', () => {
		describe('exact match', () => {
			it('finds exact match', () => {
				const content = 'const x = 1;\nconst y = 2;';
				const search = 'const x = 1;';

				const result = findMatch(content, search);

				expect(result).not.toBeNull();
				expect(result?.found).toBe(true);
				expect(result?.strategy).toBe('exact');
				expect(result?.confidence).toBe(1.0);
				expect(result?.matchedContent).toBe('const x = 1;');
				expect(result?.startIndex).toBe(0);
				expect(result?.endIndex).toBe(12);
			});

			it('finds match in middle of content', () => {
				const content = 'line1\nconst x = 1;\nline3';
				const search = 'const x = 1;';

				const result = findMatch(content, search);

				expect(result).not.toBeNull();
				expect(result?.strategy).toBe('exact');
				expect(result?.startLine).toBe(2);
			});

			it('returns null when no match', () => {
				const content = 'const x = 1;';
				const search = 'something completely different that wont match';

				const result = findMatch(content, search);

				expect(result).toBeNull();
			});
		});

		describe('whitespace-insensitive match', () => {
			it('matches with different spacing', () => {
				const content = 'const   x   =   1;';
				const search = 'const x = 1;';

				const result = findMatch(content, search);

				expect(result).not.toBeNull();
				expect(result?.strategy).toBe('whitespace');
				expect(result?.confidence).toBe(0.95);
			});

			it('matches with tabs vs spaces', () => {
				const content = 'const\tx\t=\t1;';
				const search = 'const x = 1;';

				const result = findMatch(content, search);

				expect(result).not.toBeNull();
				expect(result?.strategy).toBe('whitespace');
			});
		});

		describe('indentation-preserving match', () => {
			it('matches with different indentation', () => {
				const content = '    function foo() {\n        return 1;\n    }';
				const search = 'function foo() {\n    return 1;\n}';

				const result = findMatch(content, search);

				expect(result).not.toBeNull();
				expect(result?.strategy).toBe('indentation');
				expect(result?.confidence).toBe(0.9);
			});

			it('matches when search is substring (exact match takes precedence)', () => {
				const content = '\t\tconst x = 1;';
				const search = 'const x = 1;';

				const result = findMatch(content, search);

				expect(result).not.toBeNull();
				// Exact match works because search is a substring of content
				expect(result?.strategy).toBe('exact');
				expect(result?.startIndex).toBe(2); // After the two tabs
			});
		});

		describe('fuzzy match', () => {
			it('matches with minor differences', () => {
				const content = 'function oldName() {\n  return value + 1;\n}';
				const search = 'function oldName() {\n  return value;\n}';

				const result = findMatch(content, search, { fuzzyThreshold: 0.7 });

				expect(result).not.toBeNull();
				expect(result?.strategy).toBe('fuzzy');
				expect(result?.confidence).toBeGreaterThanOrEqual(0.7);
			});

			it('respects fuzzy threshold', () => {
				const content = 'function foo() { return 1; }';
				const search = 'function bar() { return 2; }';

				const result = findMatch(content, search, { fuzzyThreshold: 0.95 });

				// With high threshold, should not match
				expect(result).toBeNull();
			});
		});
	});

	describe('applyReplacement', () => {
		it('replaces content at matched location', () => {
			const content = 'const x = 1;\nconst y = 2;';
			const match = findMatch(content, 'const x = 1;');
			expect(match).not.toBeNull();
			if (!match) return;

			const newContent = applyReplacement(content, match, 'const x = 42;');

			expect(newContent).toBe('const x = 42;\nconst y = 2;');
		});

		it('handles deletion (empty replacement)', () => {
			const content = 'const x = 1;\nconst y = 2;';
			const match = findMatch(content, 'const x = 1;\n');
			expect(match).not.toBeNull();
			if (!match) return;

			const newContent = applyReplacement(content, match, '');

			expect(newContent).toBe('const y = 2;');
		});

		it('handles multiline replacement', () => {
			const content = 'function foo() {\n  return 1;\n}';
			const match = findMatch(content, 'return 1;');
			expect(match).not.toBeNull();
			if (!match) return;

			const newContent = applyReplacement(content, match, 'const x = 1;\n  return x;');

			expect(newContent).toBe('function foo() {\n  const x = 1;\n  return x;\n}');
		});
	});

	describe('getMatchFailure', () => {
		it('returns suggestions for similar content', () => {
			const content = 'function oldName() {\n  return value + 1;\n}';
			const search = 'function oldName() {\n  return value;\n}';

			const failure = getMatchFailure(content, search);

			expect(failure.reason).toContain('not found');
			expect(failure.suggestions.length).toBeGreaterThan(0);
			expect(failure.suggestions[0].similarity).toBeGreaterThan(0.5);
		});

		it('returns empty suggestions when no similar content', () => {
			const content = 'const x = 1;';
			const search = 'completely different content that does not match at all';

			const failure = getMatchFailure(content, search);

			expect(failure.suggestions.length).toBe(0);
		});

		it('includes nearby context when suggestions exist', () => {
			const content = 'line1\nline2\nfunction foo() { return 1; }\nline4\nline5';
			const search = 'function foo() { return 2; }';

			const failure = getMatchFailure(content, search);

			if (failure.suggestions.length > 0) {
				expect(failure.nearbyContext).toBeTruthy();
				expect(failure.nearbyContext).toContain('function');
			}
		});

		it('respects maxSuggestions option', () => {
			const content = 'const x = 1;\nconst y = 1;\nconst z = 1;';
			const search = 'const w = 1;';

			const failure = getMatchFailure(content, search, { maxSuggestions: 2 });

			expect(failure.suggestions.length).toBeLessThanOrEqual(2);
		});
	});

	describe('line number calculation', () => {
		it('returns correct 1-based line numbers', () => {
			const content = 'line1\nline2\nline3\nline4';
			const search = 'line3';

			const result = findMatch(content, search);

			expect(result).not.toBeNull();
			expect(result?.startLine).toBe(3);
			expect(result?.endLine).toBe(3);
		});

		it('handles multiline matches', () => {
			const content = 'line1\nline2\nline3\nline4\nline5';
			const search = 'line2\nline3\nline4';

			const result = findMatch(content, search);

			expect(result).not.toBeNull();
			expect(result?.startLine).toBe(2);
			expect(result?.endLine).toBe(4);
		});
	});
});

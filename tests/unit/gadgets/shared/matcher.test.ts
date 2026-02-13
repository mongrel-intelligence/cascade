import { describe, expect, it } from 'vitest';
import {
	adjustIndentation,
	applyReplacement,
	findAllMatches,
	findMatch,
	getMatchFailure,
} from '../../../../src/gadgets/shared/matcher.js';

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

			it('computes indentation delta for replacement adjustment', () => {
				const content = '    function foo() {\n        return 1;\n    }';
				const search = 'function foo() {\n    return 1;\n}';

				const result = findMatch(content, search);

				expect(result).not.toBeNull();
				expect(result?.strategy).toBe('indentation');
				expect(result?.indentationDelta).toBe('    ');
			});

			it('returns no delta when search has matching indentation', () => {
				const content = '    function foo() {\n        return 1;\n    }';
				const search = '    function foo() {\n        return 1;\n    }';

				const result = findMatch(content, search);

				expect(result).not.toBeNull();
				// Should be exact match since indentation is the same
				expect(result?.strategy).toBe('exact');
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

	describe('findAllMatches', () => {
		it('finds multiple occurrences of the same string', () => {
			const content = 'const x = 1;\nconst y = 2;\nconst x = 1;';
			const search = 'const x = 1;';

			const matches = findAllMatches(content, search);

			expect(matches.length).toBe(2);
			expect(matches[0].startLine).toBe(1);
			expect(matches[1].startLine).toBe(3);
		});

		it('returns empty array when no matches', () => {
			const content = 'const x = 1;';
			const search = 'no match here';

			const matches = findAllMatches(content, search);

			expect(matches.length).toBe(0);
		});

		it('returns single match when only one occurrence', () => {
			// Use distinctly different content to avoid fuzzy false positives
			const content = 'const userName = "alice";\nfunction processData() { return true; }';
			const search = 'const userName = "alice";';

			const matches = findAllMatches(content, search);

			expect(matches.length).toBe(1);
			expect(matches[0].startLine).toBe(1);
		});

		it('finds multiple matches with different strategies', () => {
			const content = 'MAX_RETRIES = 3;\n\nMAX_RETRIES = 3;';
			const search = 'MAX_RETRIES = 3;';

			const matches = findAllMatches(content, search);

			expect(matches.length).toBe(2);
			expect(matches[0].strategy).toBe('exact');
			expect(matches[1].strategy).toBe('exact');
		});
	});

	describe('dmp match', () => {
		it('finds approximate match using diff-match-patch', () => {
			// Content with slightly modified text that other strategies might miss
			const content = 'function processData(input) {\n  return input.trim();\n}';
			const search = 'function processData(input) {\n  return input;\n}';

			// DMP should find an approximate match at lower threshold
			const result = findMatch(content, search, { fuzzyThreshold: 0.7 });

			expect(result).not.toBeNull();
			// Should match via fuzzy or dmp strategy
			expect(['fuzzy', 'dmp']).toContain(result?.strategy);
		});

		it('handles search strings longer than 32 chars', () => {
			// Create content with a multi-line function that has a slight difference
			const content = [
				'function calculateTotal(items, taxRate, discount) {',
				'  const subtotal = items.reduce((sum, item) => sum + item.price, 0);',
				'  const tax = subtotal * taxRate;',
				'  return subtotal + tax - discount;',
				'}',
			].join('\n');

			// Search for a slightly different version (> 32 chars)
			const search = [
				'function calculateTotal(items, taxRate, discount) {',
				'  const subtotal = items.reduce((sum, item) => sum + item.price, 0);',
				'  const tax = subtotal * taxRate;',
				'  return subtotal + tax;',
				'}',
			].join('\n');

			expect(search.length).toBeGreaterThan(32);

			// Should find a match via fuzzy strategy (DMP may or may not match depending on similarity)
			const result = findMatch(content, search, { fuzzyThreshold: 0.7 });

			expect(result).not.toBeNull();
			expect(result?.confidence).toBeGreaterThanOrEqual(0.7);
		});
	});

	describe('replaceAll support', () => {
		it('findAllMatches returns all matches needed for replaceAll', () => {
			const content = 'const MAX = 100;\nconst y = 2;\nconst MAX = 100;';
			const search = 'const MAX = 100;';

			const matches = findAllMatches(content, search);

			expect(matches.length).toBe(2);
			// Both matches should have startIndex/endIndex for reverse-order replacement
			expect(matches[0]).toHaveProperty('startIndex');
			expect(matches[0]).toHaveProperty('endIndex');
			expect(matches[1]).toHaveProperty('startIndex');
			expect(matches[1]).toHaveProperty('endIndex');
		});

		it('applyReplacement works on each match individually', () => {
			const content = 'const x = 1;\nconst y = 2;\nconst x = 1;';
			const search = 'const x = 1;';

			const matches = findAllMatches(content, search);
			expect(matches.length).toBe(2);

			// Apply replacements in reverse order (as replaceAll does)
			let newContent = content;
			const sortedMatches = [...matches].sort((a, b) => b.startIndex - a.startIndex);

			for (const match of sortedMatches) {
				newContent = applyReplacement(newContent, match, 'const x = 42;');
			}

			expect(newContent).toBe('const x = 42;\nconst y = 2;\nconst x = 42;');
		});

		it('can delete all matches when replace is empty', () => {
			const content = 'DEBUG;\ncode here;\nDEBUG;';
			const search = 'DEBUG;';

			const matches = findAllMatches(content, search);
			expect(matches.length).toBe(2);

			// Apply deletions in reverse order
			let newContent = content;
			const sortedMatches = [...matches].sort((a, b) => b.startIndex - a.startIndex);

			for (const match of sortedMatches) {
				newContent = applyReplacement(newContent, match, '');
			}

			// Newlines remain but DEBUG; is removed from both locations
			expect(newContent).toBe('\ncode here;\n');
		});
	});

	describe('adjustIndentation', () => {
		it('adds indentation to each non-empty line', () => {
			const replacement = 'function foo() {\n  return 1;\n}';
			const result = adjustIndentation(replacement, '    ');

			expect(result).toBe('    function foo() {\n      return 1;\n    }');
		});

		it('preserves empty lines without adding indentation', () => {
			const replacement = 'line1\n\nline3';
			const result = adjustIndentation(replacement, '  ');

			expect(result).toBe('  line1\n\n  line3');
		});

		it('handles single-line replacement', () => {
			const replacement = 'return 42;';
			const result = adjustIndentation(replacement, '\t\t');

			expect(result).toBe('\t\treturn 42;');
		});

		it('returns unchanged content with empty delta', () => {
			const replacement = 'const x = 1;';
			const result = adjustIndentation(replacement, '');

			expect(result).toBe('const x = 1;');
		});
	});

	describe('indentation-preserving replacement integration', () => {
		it('indentationMatch provides delta for unindented search against indented content', () => {
			// Content is indented at 4 spaces
			const content = 'class Foo {\n    getValue() {\n        return 42;\n    }\n}';
			// Search has no indentation
			const search = 'getValue() {\n    return 42;\n}';

			const result = findMatch(content, search);

			expect(result).not.toBeNull();
			expect(result?.strategy).toBe('indentation');
			expect(result?.indentationDelta).toBe('    ');
		});

		it('replacement with delta produces correctly indented output', () => {
			const content = 'class Foo {\n    getValue() {\n        return 42;\n    }\n}';
			const search = 'getValue() {\n    return 42;\n}';

			const result = findMatch(content, search);
			expect(result).not.toBeNull();
			if (!result) return;

			// Simulate what FileSearchAndReplace does: adjust replacement indentation
			const replacement = 'getValue() {\n    return 99;\n}';
			const adjusted =
				result.strategy === 'indentation' && result.indentationDelta
					? adjustIndentation(replacement, result.indentationDelta)
					: replacement;

			const newContent = applyReplacement(content, result, adjusted);

			expect(newContent).toBe('class Foo {\n    getValue() {\n        return 99;\n    }\n}');
		});
	});
});

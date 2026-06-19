import { describe, expect, it } from 'vitest';

import {
	MAX_SUGGESTION_DISTANCE,
	MAX_SUGGESTION_RATIO,
	suggestClosest,
} from '../../../../../src/gadgets/shared/cli/suggestions.js';

describe('suggestClosest', () => {
	it('suggests the closest candidate when a single typo is within the distance budget', () => {
		expect(suggestClosest('coment', ['comments', 'body'])).toBe('comments');
	});

	it('suggests an exact match when present', () => {
		expect(suggestClosest('comments', ['comments', 'body'])).toBe('comments');
	});

	it('breaks ties by input order (first equally-close candidate wins)', () => {
		// distance('foo', 'fop') === distance('foo', 'foop') === 1, so the
		// iteration order of the candidate array decides which one wins. This
		// matches the existing canonical-before-alias tie-breaking that
		// `suggestFlag()` depends on.
		expect(suggestClosest('foo', ['fop', 'foop'])).toBe('fop');
		expect(suggestClosest('foo', ['foop', 'fop'])).toBe('foop');
	});

	it('returns null when no candidate is within the distance budget', () => {
		// Distance from 'zzzzzzzz' to either candidate is 8, well past the budget.
		expect(suggestClosest('zzzzzzzz', ['comments', 'body'])).toBeNull();
	});

	it('returns null for an empty candidate list', () => {
		expect(suggestClosest('foo', [])).toBeNull();
	});

	it('rejects far matches even when the distance gate alone would pass on short candidates', () => {
		// distance('foo', 'bar') === 3 → fails the distance gate already.
		expect(suggestClosest('foo', ['bar'])).toBeNull();
	});

	it('rejects matches that pass the distance gate but fail the ratio gate', () => {
		// distance('ab', 'cd') === 2 — passes MAX_SUGGESTION_DISTANCE (2) but the
		// ratio is 2/2 = 1.0, which is well above MAX_SUGGESTION_RATIO (0.4).
		expect(suggestClosest('ab', ['cd'])).toBeNull();
	});

	it('handles an empty unknown string by returning null when no candidate is close enough', () => {
		// distance('', 'body') === 4 → fails the distance gate.
		expect(suggestClosest('', ['body'])).toBeNull();
	});

	it('keeps the documented thresholds stable so flag + future command suggestions agree', () => {
		expect(MAX_SUGGESTION_DISTANCE).toBe(2);
		expect(MAX_SUGGESTION_RATIO).toBe(0.4);
	});
});

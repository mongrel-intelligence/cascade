import { describe, expect, it } from 'vitest';

import {
	classifyParseError,
	isNonexistentFlagError,
	suggestFlag,
} from '../../../../../src/gadgets/shared/cli/parseErrors.js';

describe('CLI parse errors', () => {
	it('suggests the canonical flag when an alias is the closest match', () => {
		expect(
			suggestFlag('coment', [
				{ canonical: 'comments', aliases: ['comment'] },
				{ canonical: 'body', aliases: [] },
			]),
		).toBe('comments');
		expect(suggestFlag('zzzzzzzz', [{ canonical: 'comments', aliases: ['comment'] }])).toBeNull();
	});

	it('uses the canonical flag length for alias ratio gating', () => {
		expect(suggestFlag('y', [{ canonical: 'long-flag-name', aliases: ['x'] }])).toBe(
			'long-flag-name',
		);
	});

	it('recognizes oclif nonexistent-flag error shapes', () => {
		class NonExistentFlagsError extends Error {
			public flags = ['coment'];
		}
		expect(isNonexistentFlagError(new NonExistentFlagsError('bad'))).toBe(true);
		expect(isNonexistentFlagError(new Error('bad'))).toBe(false);
	});

	it('classifies required, enum, and positional parse failures', () => {
		class FailedFlagValidationError extends Error {}
		class FlagInvalidOptionError extends Error {}
		class UnexpectedArgsError extends Error {}

		expect(classifyParseError(new FailedFlagValidationError('Missing required flag body'))).toEqual(
			expect.objectContaining({ type: 'missing-required', flag: 'body' }),
		);
		expect(
			classifyParseError(
				new FlagInvalidOptionError('Expected --state=bad to be one of: open, closed'),
			),
		).toEqual(expect.objectContaining({ type: 'enum-mismatch', flag: 'state', got: 'bad' }));
		expect(classifyParseError(new UnexpectedArgsError('Unexpected argument: banana'))).toEqual(
			expect.objectContaining({ type: 'flag-parse', got: 'banana' }),
		);
	});
});

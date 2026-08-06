import { describe, expect, it } from 'vitest';

import type { PersonaIdentities } from '../../../../src/github/personas.js';
import {
	type AuthorMode,
	evaluateAuthorMode,
	resolveAuthorMode,
} from '../../../../src/triggers/shared/author-mode.js';

const personas: PersonaIdentities = {
	implementer: 'cascade-impl',
	reviewer: 'cascade-rev',
};

describe('resolveAuthorMode', () => {
	it.each<[Record<string, unknown>, AuthorMode]>([
		[{ authorMode: 'own' }, 'own'],
		[{ authorMode: 'external' }, 'external'],
		[{ authorMode: 'all' }, 'all'],
	])('returns the validated value for %o', (parameters, expected) => {
		expect(resolveAuthorMode(parameters)).toBe(expected);
	});

	it('falls back to own when authorMode is absent', () => {
		expect(resolveAuthorMode({})).toBe('own');
	});

	it('falls back to own on an unrecognised value', () => {
		expect(resolveAuthorMode({ authorMode: 'bogus' })).toBe('own');
	});
});

describe('evaluateAuthorMode', () => {
	it('returns null when personaIdentities is missing', () => {
		expect(evaluateAuthorMode('anyone', undefined, {}, 'h')).toBeNull();
	});

	// own/external/all × cascade-impl / cascade-reviewer / human matrix.
	it.each<[AuthorMode, string, boolean]>([
		['own', 'cascade-impl', true],
		['own', 'cascade-rev', true],
		['own', 'some-human', false],
		['external', 'cascade-impl', false],
		['external', 'cascade-rev', false],
		['external', 'some-human', true],
		['all', 'cascade-impl', true],
		['all', 'cascade-rev', true],
		['all', 'some-human', true],
	])('authorMode %s + author %s → shouldTrigger=%s', (authorMode, login, shouldTrigger) => {
		const result = evaluateAuthorMode(login, personas, { authorMode }, 'h');
		expect(result).not.toBeNull();
		expect(result?.shouldTrigger).toBe(shouldTrigger);
		expect(result?.authorMode).toBe(authorMode);
	});

	it('recognises the [bot]-suffixed persona variants as cascade PRs', () => {
		const result = evaluateAuthorMode('cascade-impl[bot]', personas, { authorMode: 'own' }, 'h');
		expect(result?.isCascadePR).toBe(true);
		expect(result?.shouldTrigger).toBe(true);
	});
});

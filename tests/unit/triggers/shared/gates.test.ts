import { describe, expect, it } from 'vitest';

import type { PersonaIdentities } from '../../../../src/github/personas.js';
import {
	gateAttemptLimit,
	gateAuthorMode,
	gateBaseBranch,
	gateCascadePersona,
	gateForkWriteAccess,
	requirePersonaIdentities,
} from '../../../../src/triggers/shared/gates.js';
import type { ProjectConfig } from '../../../../src/types/index.js';
import { createMockProject } from '../../../helpers/factories.js';

const mockProject: ProjectConfig = createMockProject();

const mockPersonas: PersonaIdentities = {
	implementer: 'cascade-impl',
	reviewer: 'cascade-rev',
};

// `gateTriggerEnabled` was deleted on 2026-05-09 as part of the disabled-trigger
// shadowing fix. Handlers now call `checkTriggerEnabled` (boolean) directly:
//   `if (!(await checkTriggerEnabled(...))) return null;`
// — see `src/triggers/shared/trigger-check.ts` for the contract and
// `tests/unit/triggers/shared/trigger-check.test.ts` for the assertions.

describe('gateBaseBranch', () => {
	it('returns null when prBaseRef matches project.baseBranch', () => {
		expect(gateBaseBranch('main', 42, mockProject, 'check-suite-failure')).toBeNull();
	});

	it('returns a structured skip when baseRef does not match', () => {
		const result = gateBaseBranch('develop', 42, mockProject, 'check-suite-failure');
		expect(result?.skipReason?.handler).toBe('check-suite-failure');
		expect(result?.skipReason?.message).toContain(
			'PR #42 targets develop, not project base branch main',
		);
	});
});

describe('gateCascadePersona', () => {
	it('returns null when prAuthor matches the implementer persona', () => {
		expect(gateCascadePersona('cascade-impl', 42, mockPersonas, 'check-suite-failure')).toBeNull();
	});

	it('returns null when prAuthor matches the reviewer persona', () => {
		// User-confirmed widening from the 2026-04-29 incident: respond-to-ci
		// must fire for either persona.
		expect(gateCascadePersona('cascade-rev', 42, mockPersonas, 'check-suite-failure')).toBeNull();
	});

	it('returns null when prAuthor is the [bot]-suffix variant of either persona', () => {
		expect(gateCascadePersona('cascade-impl[bot]', 42, mockPersonas, 'h')).toBeNull();
		expect(gateCascadePersona('cascade-rev[bot]', 42, mockPersonas, 'h')).toBeNull();
	});

	it('returns a structured skip when prAuthor is a non-cascade human', () => {
		const result = gateCascadePersona('some-human', 42, mockPersonas, 'check-suite-failure');
		expect(result?.skipReason?.handler).toBe('check-suite-failure');
		expect(result?.skipReason?.message).toMatch(
			/PR #42 not authored by a cascade persona.*some-human/,
		);
	});
});

describe('gateAuthorMode', () => {
	// authorMode 'own' (default): only cascade personas pass.
	it("passes cascade authors and skips humans under authorMode 'own'", () => {
		expect(
			gateAuthorMode('cascade-impl', 42, mockPersonas, { authorMode: 'own' }, 'respond-to-ci'),
		).toBeNull();
		expect(
			gateAuthorMode('cascade-rev', 42, mockPersonas, { authorMode: 'own' }, 'respond-to-ci'),
		).toBeNull();

		const humanSkip = gateAuthorMode(
			'some-human',
			42,
			mockPersonas,
			{ authorMode: 'own' },
			'respond-to-ci',
		);
		expect(humanSkip?.skipReason?.handler).toBe('respond-to-ci');
		expect(humanSkip?.skipReason?.message).toMatch(
			/author some-human does not match configured authorMode 'own' \(isCascadePR=false\)/,
		);
	});

	// authorMode 'external': only non-cascade authors pass.
	it("passes humans and skips cascade authors under authorMode 'external'", () => {
		expect(
			gateAuthorMode(
				'some-human',
				42,
				mockPersonas,
				{ authorMode: 'external' },
				'resolve-conflicts',
			),
		).toBeNull();

		const cascadeSkip = gateAuthorMode(
			'cascade-impl',
			42,
			mockPersonas,
			{ authorMode: 'external' },
			'resolve-conflicts',
		);
		expect(cascadeSkip?.skipReason?.message).toMatch(
			/author cascade-impl does not match configured authorMode 'external' \(isCascadePR=true\)/,
		);
	});

	// authorMode 'all': every author passes.
	it("passes both cascade and human authors under authorMode 'all'", () => {
		expect(gateAuthorMode('cascade-impl', 42, mockPersonas, { authorMode: 'all' }, 'h')).toBeNull();
		expect(gateAuthorMode('some-human', 42, mockPersonas, { authorMode: 'all' }, 'h')).toBeNull();
	});

	// Missing/invalid authorMode falls back to 'own'.
	it('defaults to own when authorMode is absent', () => {
		expect(gateAuthorMode('cascade-impl', 42, mockPersonas, {}, 'h')).toBeNull();
		const humanSkip = gateAuthorMode('some-human', 42, mockPersonas, {}, 'h');
		expect(humanSkip?.skipReason?.message).toMatch(/authorMode 'own'/);
	});
});

describe('gateForkWriteAccess', () => {
	it('returns null for a same-repo (non-fork) PR', () => {
		expect(
			gateForkWriteAccess({ isFork: false, headRepoFullName: 'owner/repo' }, 42, 'respond-to-ci'),
		).toBeNull();
	});

	it('returns null when isFork is undefined (older mocks default to non-fork)', () => {
		expect(gateForkWriteAccess({}, 42, 'respond-to-ci')).toBeNull();
	});

	it('returns a structured skip naming the fork head repo', () => {
		const result = gateForkWriteAccess(
			{ isFork: true, headRepoFullName: 'contributor/repo' },
			42,
			'respond-to-ci',
		);
		expect(result?.skipReason?.handler).toBe('respond-to-ci');
		expect(result?.skipReason?.message).toMatch(
			/PR #42 head branch lives on fork contributor\/repo.*no write access.*respond-to-ci/i,
		);
	});

	it('returns a skip with a deleted-fork phrasing when headRepoFullName is null', () => {
		const result = gateForkWriteAccess(
			{ isFork: true, headRepoFullName: null },
			42,
			'resolve-conflicts',
		);
		expect(result?.skipReason?.message).toMatch(/deleted\/unavailable fork head/i);
	});
});

describe('gateAttemptLimit', () => {
	it('returns null when attempts is below the limit', () => {
		expect(gateAttemptLimit(0, 3, 42, 'h')).toBeNull();
		expect(gateAttemptLimit(2, 3, 42, 'h')).toBeNull();
	});

	it('returns a structured skip when attempts >= the limit', () => {
		const result = gateAttemptLimit(3, 3, 42, 'check-suite-failure');
		expect(result?.skipReason?.handler).toBe('check-suite-failure');
		expect(result?.skipReason?.message).toMatch(/Max auto-fix attempts \(3\) reached for PR #42/);
	});
});

describe('requirePersonaIdentities', () => {
	it('returns ok=true with the narrowed value when personaIdentities is defined', () => {
		const result = requirePersonaIdentities(mockPersonas, 42, 'h');
		expect(result.ok).toBe(true);
		if (result.ok) {
			// TypeScript narrows result.value to PersonaIdentities here.
			expect(result.value).toBe(mockPersonas);
		}
	});

	it('returns ok=false with a structured skip when personaIdentities is undefined', () => {
		const result = requirePersonaIdentities(undefined, 42, 'check-suite-failure');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.skip.skipReason?.handler).toBe('check-suite-failure');
			expect(result.skip.skipReason?.message).toMatch(/persona identities could not be resolved/);
		}
	});

	it('returns ok=false even when prNumber is undefined', () => {
		const result = requirePersonaIdentities(undefined, undefined, 'pr-comment-mention');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.skip.skipReason?.handler).toBe('pr-comment-mention');
		}
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockTriggerCheckModule } from '../../../helpers/sharedMocks.js';

vi.mock('../../../../src/triggers/shared/trigger-check.js', () => mockTriggerCheckModule);

import type { PersonaIdentities } from '../../../../src/github/personas.js';
import {
	gateAttemptLimit,
	gateBaseBranch,
	gateCascadePersona,
	gateTriggerEnabled,
	requirePersonaIdentities,
} from '../../../../src/triggers/shared/gates.js';
import { checkTriggerEnablement } from '../../../../src/triggers/shared/trigger-check.js';
import type { ProjectConfig } from '../../../../src/types/index.js';
import { createMockProject } from '../../../helpers/factories.js';

const mockProject: ProjectConfig = createMockProject();

const mockPersonas: PersonaIdentities = {
	implementer: 'cascade-impl',
	reviewer: 'cascade-rev',
};

describe('gateTriggerEnabled', () => {
	beforeEach(() => {
		vi.mocked(checkTriggerEnablement).mockReset();
	});

	it('returns null when checkTriggerEnablement has no skip result', async () => {
		vi.mocked(checkTriggerEnablement).mockResolvedValue({
			enabled: true,
			parameters: {},
			skipResult: null,
		});
		const result = await gateTriggerEnabled(
			'proj',
			'respond-to-ci',
			'scm:check-suite-failure',
			'check-suite-failure',
		);
		expect(result).toBeNull();
	});

	it('returns the centralized structured skip when checkTriggerEnablement resolves disabled', async () => {
		vi.mocked(checkTriggerEnablement).mockResolvedValue({
			enabled: false,
			parameters: {},
			skipResult: {
				agentType: null,
				agentInput: {},
				skipReason: {
					handler: 'check-suite-failure',
					message: 'respond-to-ci trigger is disabled for this project',
				},
			},
		});
		const result = await gateTriggerEnabled(
			'proj',
			'respond-to-ci',
			'scm:check-suite-failure',
			'check-suite-failure',
		);
		expect(result?.agentType).toBeNull();
		expect(result?.skipReason).toEqual({
			handler: 'check-suite-failure',
			message: 'respond-to-ci trigger is disabled for this project',
		});
	});
});

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

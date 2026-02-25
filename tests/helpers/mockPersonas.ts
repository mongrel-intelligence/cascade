import type { PersonaIdentities } from '../../src/github/personas.js';

/**
 * Standard mock persona identities used in trigger tests.
 */
export const mockPersonaIdentities: PersonaIdentities = {
	implementer: 'cascade-impl',
	reviewer: 'cascade-reviewer',
};

/** Convenience constants for readable assertions. */
export const IMPLEMENTER_USERNAME = 'cascade-impl';
export const REVIEWER_USERNAME = 'cascade-reviewer';

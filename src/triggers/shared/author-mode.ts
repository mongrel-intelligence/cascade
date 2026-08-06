import { isCascadeBot, type PersonaIdentities } from '../../github/personas.js';
import { logger } from '../../utils/logging.js';

/**
 * Single source of truth for the `authorMode` trigger parameter.
 *
 * Previously the author-mode logic lived in three near-duplicate copies
 * (`triggers/github/utils.ts:evaluateAuthorMode`,
 * `triggers/github/check-suite-decision.ts:authorModeDecision`, and the
 * `pr-opened` path). This module consolidates the core so every hard-gated
 * caller (review, respond-to-ci, resolve-conflicts) shares one implementation.
 *
 * "own" means the PR was authored by any CASCADE persona (implementer OR
 * reviewer). "external" means a non-CASCADE author. "all" matches every author.
 */

export type AuthorMode = 'own' | 'external' | 'all';

const VALID_AUTHOR_MODES: readonly AuthorMode[] = ['own', 'external', 'all'];

export interface AuthorModeResult {
	shouldTrigger: boolean;
	authorMode: AuthorMode;
	isCascadePR: boolean;
}

/**
 * Resolve the configured `authorMode` parameter to a validated value.
 *
 * Validates against the known set (`own` / `external` / `all`) and
 * warn-and-falls-back to `own` on an unrecognised string. `own` is the safe
 * default: it preserves the historical CASCADE-authored-only behavior.
 */
export function resolveAuthorMode(
	parameters: Record<string, unknown>,
	handlerName?: string,
): AuthorMode {
	const rawMode = parameters.authorMode;
	if (typeof rawMode === 'string' && VALID_AUTHOR_MODES.includes(rawMode as AuthorMode)) {
		return rawMode as AuthorMode;
	}
	if (typeof rawMode === 'string') {
		logger.warn('Invalid authorMode value, falling back to "own"', {
			handler: handlerName,
			configuredValue: rawMode,
		});
	}
	return 'own';
}

/**
 * Evaluate whether a trigger should fire based on the PR author and the
 * configured `authorMode` parameter.
 *
 * Returns `null` when `personaIdentities` is missing (caller should return a
 * structured skip). Validates authorMode against known values and falls back
 * to `own`.
 */
export function evaluateAuthorMode(
	prAuthorLogin: string,
	personaIdentities: PersonaIdentities | undefined,
	parameters: Record<string, unknown>,
	handlerName: string,
): AuthorModeResult | null {
	if (!personaIdentities) {
		logger.info('No persona identities available, skipping', { handler: handlerName });
		return null;
	}

	const authorMode = resolveAuthorMode(parameters, handlerName);
	const isCascadePR = isCascadeBot(prAuthorLogin, personaIdentities);

	const shouldTrigger =
		authorMode === 'all' ||
		(authorMode === 'own' && isCascadePR) ||
		(authorMode === 'external' && !isCascadePR);

	return { shouldTrigger, authorMode, isCascadePR };
}

import { getIntegrationCredential } from '../config/provider.js';
import { logger } from '../utils/logging.js';
import { getGitLabUserForToken } from './client.js';

// ============================================================================
// Types
// ============================================================================

export type GitLabPersona = 'implementer' | 'reviewer';

export interface PersonaIdentities {
	implementer: string;
	reviewer: string;
}

// ============================================================================
// Agent → Persona Mapping
// ============================================================================

/**
 * Maps agent types to their GitLab personas.
 *
 * This is the canonical registration point for agent persona assignments.
 * - `'implementer'` — uses the implementer GitLab token for all SCM operations
 * - `'reviewer'`    — uses the reviewer GitLab token, appropriate for agents
 *   that submit MR reviews (e.g. the built-in `review` agent)
 *
 * To add a custom agent with reviewer behaviour, add an entry here:
 * ```ts
 * 'my-custom-reviewer': 'reviewer',
 * ```
 * Any agent type not listed here defaults to `'implementer'`.
 */
const AGENT_PERSONA_MAP: Record<string, GitLabPersona> = {
	splitting: 'implementer',
	planning: 'implementer',
	implementation: 'implementer',
	'respond-to-review': 'implementer',
	'respond-to-ci': 'implementer',
	'respond-to-pr-comment': 'implementer',
	'respond-to-planning-comment': 'implementer',
	review: 'reviewer',
	debug: 'implementer',
};

export function getPersonaForAgentType(agentType: string): GitLabPersona {
	return AGENT_PERSONA_MAP[agentType] ?? 'implementer';
}

// ============================================================================
// Token Resolution
// ============================================================================

/**
 * Resolve the correct GitLab token for a project + agent type based on persona.
 * Uses integration credentials linked to the SCM integration.
 * Throws if no token is found.
 */
export async function getPersonaToken(projectId: string, agentType: string): Promise<string> {
	const persona = getPersonaForAgentType(agentType);
	const role = persona === 'implementer' ? 'implementer_token' : 'reviewer_token';

	return getIntegrationCredential(projectId, 'scm', 'gitlab', role);
}

// ============================================================================
// Identity Resolution
// ============================================================================

const PERSONA_CACHE_TTL_MS = 60_000; // 60 seconds — matches the Trello/JIRA BotIdentityCache TTL

interface CacheEntry {
	value: PersonaIdentities;
	expiresAt: number;
}

// Per-project TTL cache for persona identities.
// Unlike BotIdentityCache, errors are re-thrown so callers retain error semantics.
const personaIdentityCache = new Map<string, CacheEntry>();

/**
 * Resolve both persona GitLab usernames for a project.
 * Results are cached per-project with a 60s TTL to avoid redundant DB + API calls
 * on rapid successive webhooks (e.g. multiple events within the same request batch).
 * Errors are re-thrown so callers can handle credential failures.
 */
export async function resolvePersonaIdentities(projectId: string): Promise<PersonaIdentities> {
	const cached = personaIdentityCache.get(projectId);
	if (cached && Date.now() < cached.expiresAt) return cached.value;

	// Parallelize credential lookups to halve round-trip latency
	const [implementerToken, reviewerToken] = await Promise.all([
		getIntegrationCredential(projectId, 'scm', 'gitlab', 'implementer_token'),
		getIntegrationCredential(projectId, 'scm', 'gitlab', 'reviewer_token'),
	]);

	const [implementerLogin, reviewerLogin] = await Promise.all([
		getGitLabUserForToken(implementerToken),
		getGitLabUserForToken(reviewerToken),
	]);

	if (!implementerLogin) {
		throw new Error(
			`Failed to resolve GitLab identity for implementer token in project '${projectId}'`,
		);
	}
	if (!reviewerLogin) {
		throw new Error(
			`Failed to resolve GitLab identity for reviewer token in project '${projectId}'`,
		);
	}

	const identities: PersonaIdentities = {
		implementer: implementerLogin,
		reviewer: reviewerLogin,
	};

	logger.info('Resolved persona identities', {
		projectId,
		implementer: implementerLogin,
		reviewer: reviewerLogin,
	});

	personaIdentityCache.set(projectId, {
		value: identities,
		expiresAt: Date.now() + PERSONA_CACHE_TTL_MS,
	});
	return identities;
}

/** @internal Visible for testing only */
export function _resetPersonaIdentityCache(): void {
	personaIdentityCache.clear();
}

// ============================================================================
// Bot Detection
// ============================================================================

/**
 * Check if a GitLab username belongs to either CASCADE persona.
 */
export function isCascadeBot(username: string, identities: PersonaIdentities): boolean {
	return username === identities.implementer || username === identities.reviewer;
}

/**
 * Get the persona for a GitLab username, or null if not a known persona.
 */
export function getPersonaForLogin(
	username: string,
	identities: PersonaIdentities,
): GitLabPersona | null {
	if (username === identities.implementer) return 'implementer';
	if (username === identities.reviewer) return 'reviewer';
	return null;
}

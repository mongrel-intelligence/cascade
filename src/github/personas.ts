import { getIntegrationCredential } from '../config/provider.js';
import { logger } from '../utils/logging.js';
import { getGitHubUserForToken } from './client.js';

// ============================================================================
// Types
// ============================================================================

export type GitHubPersona = 'implementer' | 'reviewer';

export interface PersonaIdentities {
	implementer: string;
	reviewer: string;
}

// ============================================================================
// Agent → Persona Mapping
// ============================================================================

const AGENT_PERSONA_MAP: Record<string, GitHubPersona> = {
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

export function getPersonaForAgentType(agentType: string): GitHubPersona {
	return AGENT_PERSONA_MAP[agentType] ?? 'implementer';
}

// ============================================================================
// Token Resolution
// ============================================================================

/**
 * Resolve the correct GitHub token for a project + agent type based on persona.
 * Uses integration credentials linked to the SCM integration.
 * Throws if no token is found.
 */
export async function getPersonaToken(projectId: string, agentType: string): Promise<string> {
	const persona = getPersonaForAgentType(agentType);
	const role = persona === 'implementer' ? 'implementer_token' : 'reviewer_token';

	return getIntegrationCredential(projectId, 'scm', role);
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
 * Resolve both persona GitHub usernames for a project.
 * Results are cached per-project with a 60s TTL to avoid redundant DB + API calls
 * on rapid successive webhooks (e.g. multiple events within the same request batch).
 * Errors are re-thrown so callers can handle credential failures.
 */
export async function resolvePersonaIdentities(projectId: string): Promise<PersonaIdentities> {
	const cached = personaIdentityCache.get(projectId);
	if (cached && Date.now() < cached.expiresAt) return cached.value;

	// Parallelize credential lookups to halve round-trip latency
	const [implementerToken, reviewerToken] = await Promise.all([
		getIntegrationCredential(projectId, 'scm', 'implementer_token'),
		getIntegrationCredential(projectId, 'scm', 'reviewer_token'),
	]);

	const [implementerLogin, reviewerLogin] = await Promise.all([
		getGitHubUserForToken(implementerToken),
		getGitHubUserForToken(reviewerToken),
	]);

	if (!implementerLogin) {
		throw new Error(
			`Failed to resolve GitHub identity for implementer token in project '${projectId}'`,
		);
	}
	if (!reviewerLogin) {
		throw new Error(
			`Failed to resolve GitHub identity for reviewer token in project '${projectId}'`,
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
 * Check if a GitHub login belongs to either CASCADE persona.
 */
export function isCascadeBot(login: string, identities: PersonaIdentities): boolean {
	return (
		login === identities.implementer ||
		login === identities.reviewer ||
		login === `${identities.implementer}[bot]` ||
		login === `${identities.reviewer}[bot]`
	);
}

/**
 * Get the persona for a GitHub login, or null if not a known persona.
 */
export function getPersonaForLogin(
	login: string,
	identities: PersonaIdentities,
): GitHubPersona | null {
	if (login === identities.implementer || login === `${identities.implementer}[bot]`) {
		return 'implementer';
	}
	if (login === identities.reviewer || login === `${identities.reviewer}[bot]`) {
		return 'reviewer';
	}
	return null;
}

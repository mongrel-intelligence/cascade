import { getAgentCredential } from '../config/provider.js';
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
	briefing: 'implementer',
	planning: 'implementer',
	implementation: 'implementer',
	'respond-to-review': 'implementer',
	'respond-to-ci': 'implementer',
	'respond-to-pr-comment': 'implementer',
	'respond-to-planning-comment': 'implementer',
	review: 'reviewer',
	debug: 'implementer',
};

const PERSONA_TOKEN_KEYS: Record<GitHubPersona, string> = {
	implementer: 'GITHUB_TOKEN_IMPLEMENTER',
	reviewer: 'GITHUB_TOKEN_REVIEWER',
};

export function getPersonaForAgentType(agentType: string): GitHubPersona {
	return AGENT_PERSONA_MAP[agentType] ?? 'implementer';
}

export function getTokenKeyForPersona(persona: GitHubPersona): string {
	return PERSONA_TOKEN_KEYS[persona];
}

// ============================================================================
// Token Resolution
// ============================================================================

/**
 * Resolve the correct GitHub token for a project + agent type based on persona.
 * Uses agent-scoped credential overrides for flexibility.
 * Throws if no token is found (no fallback to legacy GITHUB_TOKEN).
 */
export async function getPersonaToken(projectId: string, agentType: string): Promise<string> {
	const persona = getPersonaForAgentType(agentType);
	const tokenKey = PERSONA_TOKEN_KEYS[persona];

	const token = await getAgentCredential(projectId, agentType, tokenKey);
	if (token) return token;

	throw new Error(
		`Missing ${tokenKey} for project '${projectId}' (agent: ${agentType}, persona: ${persona}). Configure credentials via the dashboard or CLI.`,
	);
}

// ============================================================================
// Identity Resolution (cached per-project)
// ============================================================================

const identityCache = new Map<string, PersonaIdentities>();

/**
 * Resolve both persona GitHub usernames for a project.
 * Cached per-project to avoid repeated API calls.
 */
export async function resolvePersonaIdentities(projectId: string): Promise<PersonaIdentities> {
	const cached = identityCache.get(projectId);
	if (cached) return cached;

	// Resolve both tokens — use getAgentCredential with a representative agent type
	const implementerToken = await getAgentCredential(
		projectId,
		'implementation',
		PERSONA_TOKEN_KEYS.implementer,
	);
	const reviewerToken = await getAgentCredential(projectId, 'review', PERSONA_TOKEN_KEYS.reviewer);

	if (!implementerToken) {
		throw new Error(
			`Missing GITHUB_TOKEN_IMPLEMENTER for project '${projectId}'. Both persona tokens are required.`,
		);
	}
	if (!reviewerToken) {
		throw new Error(
			`Missing GITHUB_TOKEN_REVIEWER for project '${projectId}'. Both persona tokens are required.`,
		);
	}

	const [implementerLogin, reviewerLogin] = await Promise.all([
		getGitHubUserForToken(implementerToken),
		getGitHubUserForToken(reviewerToken),
	]);

	if (!implementerLogin) {
		throw new Error(
			`Failed to resolve GitHub identity for GITHUB_TOKEN_IMPLEMENTER in project '${projectId}'`,
		);
	}
	if (!reviewerLogin) {
		throw new Error(
			`Failed to resolve GitHub identity for GITHUB_TOKEN_REVIEWER in project '${projectId}'`,
		);
	}

	const identities: PersonaIdentities = {
		implementer: implementerLogin,
		reviewer: reviewerLogin,
	};

	identityCache.set(projectId, identities);
	logger.info('Resolved persona identities', {
		projectId,
		implementer: implementerLogin,
		reviewer: reviewerLogin,
	});

	return identities;
}

/**
 * Clear cached identities for a project (useful for testing or credential rotation).
 */
export function clearPersonaCache(projectId?: string): void {
	if (projectId) {
		identityCache.delete(projectId);
	} else {
		identityCache.clear();
	}
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

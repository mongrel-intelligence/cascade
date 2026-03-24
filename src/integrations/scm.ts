/**
 * SCMIntegration — the category-specific interface all SCM integrations implement.
 *
 * Extends IntegrationModule with SCM-specific capabilities:
 * - `category` is narrowed to 'scm'
 * - `hasPersonaToken()` checks if a specific persona token is available
 */

import type { IntegrationModule } from './types.js';

/**
 * SCMIntegration — extends IntegrationModule with SCM-specific capabilities.
 *
 * All SCM integrations (e.g. GitHub) must implement this interface.
 * The `category` is narrowed to 'scm' to allow type-safe filtering.
 */
export interface SCMIntegration extends IntegrationModule {
	/** Narrowed category — always 'scm' for SCM integrations */
	readonly category: 'scm';

	/**
	 * Check if a specific persona token is configured for a project.
	 *
	 * @param projectId - The project to check
	 * @param persona - The persona to check ('implementer' or 'reviewer')
	 * @returns true if the persona's token is present
	 */
	hasPersonaToken(projectId: string, persona: 'implementer' | 'reviewer'): Promise<boolean>;
}

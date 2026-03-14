/**
 * SCM (GitHub) integration — credential validation helpers.
 *
 * Provides hasScmIntegration() for checking if SCM integration is configured.
 */

import { getIntegrationCredentialOrNull } from '../config/provider.js';
import { getIntegrationProvider } from '../db/repositories/credentialsRepository.js';

/**
 * Check if SCM integration is configured for a project.
 * Returns true if the integration exists and has at least one token linked.
 */
export async function hasScmIntegration(projectId: string): Promise<boolean> {
	const provider = await getIntegrationProvider(projectId, 'scm');
	if (!provider) return false;

	// Check if either token is available (some agents only need one)
	const [impl, rev] = await Promise.all([
		getIntegrationCredentialOrNull(projectId, 'scm', 'implementer_token'),
		getIntegrationCredentialOrNull(projectId, 'scm', 'reviewer_token'),
	]);

	return impl !== null || rev !== null;
}

/**
 * Check if a specific SCM persona token is configured.
 */
export async function hasScmPersonaToken(
	projectId: string,
	persona: 'implementer' | 'reviewer',
): Promise<boolean> {
	const role = persona === 'implementer' ? 'implementer_token' : 'reviewer_token';
	const token = await getIntegrationCredentialOrNull(projectId, 'scm', role);
	return token !== null;
}

/**
 * GitHubSCMIntegration — implements SCMIntegration for GitHub.
 *
 * Encapsulates GitHub SCM credential resolution and validation
 * into a unified integration class following the IntegrationModule pattern.
 *
 * Consolidates:
 * - `hasScmIntegration()` logic from src/github/integration.ts
 * - `hasScmPersonaToken()` logic from src/github/integration.ts
 * - `withGitHubToken()` usage from src/github/client.ts
 *
 * Backward compatibility: the standalone functions in src/github/integration.ts
 * remain exported and continue to work identically.
 */

import { getIntegrationCredential, getIntegrationCredentialOrNull } from '../config/provider.js';
import { getIntegrationProvider } from '../db/repositories/credentialsRepository.js';
import type { SCMIntegration } from '../integrations/scm.js';
import { withGitHubToken } from './client.js';

export class GitHubSCMIntegration implements SCMIntegration {
	readonly type = 'github';
	readonly category = 'scm' as const;

	/**
	 * Check if GitHub SCM integration is configured for a project.
	 * Returns true if the integration exists and has at least one token linked.
	 */
	async hasIntegration(projectId: string): Promise<boolean> {
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
	 * Check if a specific SCM persona token is configured for a project.
	 */
	async hasPersonaToken(projectId: string, persona: 'implementer' | 'reviewer'): Promise<boolean> {
		const role = persona === 'implementer' ? 'implementer_token' : 'reviewer_token';
		const token = await getIntegrationCredentialOrNull(projectId, 'scm', role);
		return token !== null;
	}

	/**
	 * Resolve the implementer token from credentials and run `fn` within that
	 * GitHub credential scope. Follows the same pattern as TrelloIntegration.withCredentials().
	 */
	async withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
		const token = await getIntegrationCredential(projectId, 'scm', 'implementer_token');
		return withGitHubToken(token, fn);
	}
}

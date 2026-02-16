/**
 * Shared credential scoping helper for webhook handlers.
 *
 * Resolves project secrets (PM provider keys, GitHub token, LLM keys)
 * and wraps a callback in the correct credential scopes based on PM type.
 */

import { getAgentCredential, getProjectSecret } from '../../config/provider.js';
import { withGitHubToken } from '../../github/client.js';
import { withJiraCredentials } from '../../jira/client.js';
import { createPMProvider, withPMProvider } from '../../pm/index.js';
import { withTrelloCredentials } from '../../trello/client.js';
import type { ProjectConfig } from '../../types/index.js';
import { injectLlmApiKeys } from '../../utils/llmEnv.js';

/**
 * Execute a callback with all necessary credential scopes established:
 * - PM provider credentials (Trello or JIRA)
 * - PM provider context
 * - GitHub token (org-level or agent-override)
 * - LLM API keys
 */
export async function withProjectCredentials<T>(
	project: ProjectConfig,
	agentType: string | undefined,
	callback: () => Promise<T>,
): Promise<T> {
	const pmType = project.pm?.type ?? 'trello';

	// Resolve GitHub token (with optional agent override)
	const orgGithubToken = await getProjectSecret(project.id, 'GITHUB_TOKEN');
	const agentGitHubToken = agentType
		? await getAgentCredential(project.id, agentType, 'GITHUB_TOKEN')
		: null;
	const effectiveGithubToken = agentGitHubToken || orgGithubToken;

	// Inject LLM API keys
	const restoreLlmEnv = await injectLlmApiKeys(project.id);

	try {
		const pmProvider = createPMProvider(project);

		if (pmType === 'jira') {
			// JIRA flow
			const jiraEmail = await getProjectSecret(project.id, 'JIRA_EMAIL');
			const jiraApiToken = await getProjectSecret(project.id, 'JIRA_API_TOKEN');
			const jiraBaseUrl =
				project.jira?.baseUrl ?? (await getProjectSecret(project.id, 'JIRA_BASE_URL'));

			return await withJiraCredentials(
				{ email: jiraEmail, apiToken: jiraApiToken, baseUrl: jiraBaseUrl },
				() => withPMProvider(pmProvider, () => withGitHubToken(effectiveGithubToken, callback)),
			);
		}

		// Trello flow (default)
		const trelloApiKey = await getProjectSecret(project.id, 'TRELLO_API_KEY').catch(() => '');
		const trelloToken = await getProjectSecret(project.id, 'TRELLO_TOKEN').catch(() => '');

		return await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, () =>
			withPMProvider(pmProvider, () => withGitHubToken(effectiveGithubToken, callback)),
		);
	} finally {
		restoreLlmEnv();
	}
}

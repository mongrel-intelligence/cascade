/**
 * Shared credential scoping helper.
 * Resolves secrets and wraps execution in the correct credential scope
 * based on PM provider type (Trello, JIRA, or GitHub-only).
 */

import { getAgentCredential, getProjectSecret } from '../../config/provider.js';
import { withGitHubToken } from '../../github/client.js';
import { withJiraCredentials } from '../../jira/client.js';
import { createPMProvider, withPMProvider } from '../../pm/index.js';
import { withTrelloCredentials } from '../../trello/client.js';
import type { ProjectConfig } from '../../types/index.js';
import { injectLlmApiKeys } from '../../utils/llmEnv.js';

/**
 * Execute a function with project credentials resolved and scoped.
 * Automatically selects the correct credential wrapper based on PM provider type.
 */
export async function withProjectCredentials<T>(
	project: ProjectConfig,
	agentType: string,
	fn: () => Promise<T>,
): Promise<T> {
	const pmType = project.trello ? 'trello' : project.jira ? 'jira' : 'github-only';

	// Resolve GitHub token with optional agent-specific override
	const githubToken = await getProjectSecret(project.id, 'GITHUB_TOKEN');
	const agentGitHubToken = await getAgentCredential(project.id, agentType, 'GITHUB_TOKEN');
	const effectiveGithubToken = agentGitHubToken || githubToken;

	// Inject LLM API keys
	const restoreLlmEnv = await injectLlmApiKeys(project.id);

	try {
		const pmProvider = createPMProvider(project);

		if (pmType === 'trello') {
			// Trello-based PM provider
			const trelloApiKey = await getProjectSecret(project.id, 'TRELLO_API_KEY');
			const trelloToken = await getProjectSecret(project.id, 'TRELLO_TOKEN');

			return await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, () =>
				withPMProvider(pmProvider, () => withGitHubToken(effectiveGithubToken, fn)),
			);
		}

		if (pmType === 'jira') {
			// JIRA-based PM provider
			const jiraEmail = await getProjectSecret(project.id, 'JIRA_EMAIL');
			const jiraApiToken = await getProjectSecret(project.id, 'JIRA_API_TOKEN');
			const jiraBaseUrl =
				project.jira?.baseUrl ?? (await getProjectSecret(project.id, 'JIRA_BASE_URL'));

			return await withJiraCredentials(
				{ email: jiraEmail, apiToken: jiraApiToken, baseUrl: jiraBaseUrl },
				() => withPMProvider(pmProvider, () => withGitHubToken(effectiveGithubToken, fn)),
			);
		}

		// GitHub-only (no PM provider credentials needed, but may have Trello for optional integrations)
		const trelloApiKey = await getProjectSecret(project.id, 'TRELLO_API_KEY').catch(() => '');
		const trelloToken = await getProjectSecret(project.id, 'TRELLO_TOKEN').catch(() => '');

		return await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, () =>
			withPMProvider(pmProvider, () => withGitHubToken(effectiveGithubToken, fn)),
		);
	} finally {
		restoreLlmEnv();
	}
}

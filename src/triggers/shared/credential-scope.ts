/**
 * Shared credential scoping for webhook handlers.
 *
 * Resolves project secrets, selects the appropriate credential wrapper
 * (Trello/JIRA/GitHub), injects LLM API keys, and executes a callback
 * within the scoped context.
 */

import { getAgentCredential, getProjectSecret } from '../../config/provider.js';
import { withGitHubToken } from '../../github/client.js';
import { withJiraCredentials } from '../../jira/client.js';
import { createPMProvider, withPMProvider } from '../../pm/index.js';
import { withTrelloCredentials } from '../../trello/client.js';
import type { ProjectConfig } from '../../types/index.js';
import { injectLlmApiKeys } from '../../utils/llmEnv.js';

/**
 * Execute a callback within project credential scope.
 *
 * Resolves secrets for the project's PM provider (Trello/JIRA) and GitHub,
 * injects LLM API keys, and wraps the callback in the appropriate credential
 * scopes (withTrelloCredentials/withJiraCredentials → withPMProvider → withGitHubToken).
 *
 * @param project Project configuration
 * @param agentType Agent type (for agent-scoped credential overrides)
 * @param fn Callback to execute with credentials in scope
 */
export async function withProjectCredentials<T>(
	project: ProjectConfig,
	agentType: string,
	fn: () => Promise<T>,
): Promise<T> {
	const pmType = project.trello ? 'trello' : project.jira ? 'jira' : null;

	if (pmType === 'trello') {
		return withTrelloCredentialsScoped(project, agentType, fn);
	}
	if (pmType === 'jira') {
		return withJiraCredentialsScoped(project, agentType, fn);
	}

	// No PM provider configured — still inject LLM keys and GitHub token
	const githubToken = await getProjectSecret(project.id, 'GITHUB_TOKEN');
	const agentGitHubToken = await getAgentCredential(project.id, agentType, 'GITHUB_TOKEN');
	const effectiveGithubToken = agentGitHubToken || githubToken;

	const restoreLlmEnv = await injectLlmApiKeys(project.id);
	try {
		return await withGitHubToken(effectiveGithubToken, fn);
	} finally {
		restoreLlmEnv();
	}
}

async function withTrelloCredentialsScoped<T>(
	project: ProjectConfig,
	agentType: string,
	fn: () => Promise<T>,
): Promise<T> {
	const trelloApiKey = await getProjectSecret(project.id, 'TRELLO_API_KEY');
	const trelloToken = await getProjectSecret(project.id, 'TRELLO_TOKEN');
	const githubToken = await getProjectSecret(project.id, 'GITHUB_TOKEN');

	const agentGitHubToken = await getAgentCredential(project.id, agentType, 'GITHUB_TOKEN');
	const effectiveGithubToken = agentGitHubToken || githubToken;

	const restoreLlmEnv = await injectLlmApiKeys(project.id);

	try {
		const pmProvider = createPMProvider(project);
		return await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, () =>
			withPMProvider(pmProvider, () => withGitHubToken(effectiveGithubToken, fn)),
		);
	} finally {
		restoreLlmEnv();
	}
}

async function withJiraCredentialsScoped<T>(
	project: ProjectConfig,
	agentType: string,
	fn: () => Promise<T>,
): Promise<T> {
	const jiraEmail = await getProjectSecret(project.id, 'JIRA_EMAIL');
	const jiraApiToken = await getProjectSecret(project.id, 'JIRA_API_TOKEN');
	const jiraBaseUrl =
		project.jira?.baseUrl ?? (await getProjectSecret(project.id, 'JIRA_BASE_URL'));
	const githubToken = await getProjectSecret(project.id, 'GITHUB_TOKEN');

	const agentGitHubToken = await getAgentCredential(project.id, agentType, 'GITHUB_TOKEN');
	const effectiveGithubToken = agentGitHubToken || githubToken;

	const restoreLlmEnv = await injectLlmApiKeys(project.id);

	try {
		const pmProvider = createPMProvider(project);
		return await withJiraCredentials(
			{ email: jiraEmail, apiToken: jiraApiToken, baseUrl: jiraBaseUrl },
			() => withPMProvider(pmProvider, () => withGitHubToken(effectiveGithubToken, fn)),
		);
	} finally {
		restoreLlmEnv();
	}
}

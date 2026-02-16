import { Command } from '@oclif/core';
import { withGitHubToken } from '../github/client.js';
import { withJiraCredentials } from '../jira/client.js';
import { createPMProvider, withPMProvider } from '../pm/index.js';
import { withTrelloCredentials } from '../trello/client.js';
import type { ProjectConfig } from '../types/index.js';

export abstract class CredentialScopedCommand extends Command {
	/** Subclasses implement this instead of run() */
	abstract execute(): Promise<void>;

	async run(): Promise<void> {
		const githubToken = process.env.GITHUB_TOKEN;
		const trelloApiKey = process.env.TRELLO_API_KEY;
		const trelloToken = process.env.TRELLO_TOKEN;
		const jiraEmail = process.env.JIRA_EMAIL;
		const jiraApiToken = process.env.JIRA_API_TOKEN;
		const jiraBaseUrl = process.env.JIRA_BASE_URL;

		let fn: () => Promise<void> = () => this.execute();

		if (githubToken) {
			const prev = fn;
			fn = () => withGitHubToken(githubToken, prev);
		}
		if (trelloApiKey && trelloToken) {
			const prev = fn;
			fn = () => withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, prev);
		}
		if (jiraEmail && jiraApiToken && jiraBaseUrl) {
			const prev = fn;
			fn = () =>
				withJiraCredentials(
					{ email: jiraEmail, apiToken: jiraApiToken, baseUrl: jiraBaseUrl },
					prev,
				);
		}

		// Establish PM provider scope — infer type from available credentials
		const pmType = jiraEmail && jiraApiToken && jiraBaseUrl ? 'jira' : 'trello';
		const pmProject = { pm: { type: pmType } } as ProjectConfig;
		const pmProvider = createPMProvider(pmProject);
		const prev = fn;
		fn = () => withPMProvider(pmProvider, prev);

		await fn();
	}
}

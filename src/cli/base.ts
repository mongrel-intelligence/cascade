import { execFileSync } from 'node:child_process';

import { Command } from '@oclif/core';
import { withGitHubToken } from '../github/client.js';
import { withJiraCredentials } from '../jira/client.js';
import { createPMProvider, withPMProvider } from '../pm/index.js';
import { withTrelloCredentials } from '../trello/client.js';
import type { ProjectConfig } from '../types/index.js';

/**
 * Resolve repository owner/repo from flags, env vars, or git remote (in that order).
 */
export function resolveOwnerRepo(
	flagOwner?: string,
	flagRepo?: string,
): { owner: string; repo: string } {
	if (flagOwner && flagRepo) return { owner: flagOwner, repo: flagRepo };

	const envOwner = process.env.CASCADE_REPO_OWNER;
	const envRepo = process.env.CASCADE_REPO_NAME;
	if (envOwner && envRepo) return { owner: envOwner, repo: envRepo };

	// Fallback: detect from git remote (same as create-pr)
	const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf-8' }).trim();
	const match = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
	if (!match) throw new Error(`Cannot detect owner/repo from git remote: ${url}`);
	return { owner: match[1], repo: match[2] };
}

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

		// Establish PM provider scope — prefer explicit env var, fall back to credential inference
		const explicitPmType = process.env.CASCADE_PM_TYPE as 'trello' | 'jira' | undefined;
		const pmType = explicitPmType ?? (jiraEmail && jiraApiToken && jiraBaseUrl ? 'jira' : 'trello');
		const jiraProjectKey = process.env.CASCADE_JIRA_PROJECT_KEY;
		const jiraStatuses = process.env.CASCADE_JIRA_STATUSES;

		const pmProject = {
			pm: { type: pmType },
			...(pmType === 'jira' && {
				jira: {
					projectKey: jiraProjectKey ?? '',
					baseUrl: jiraBaseUrl as string,
					statuses: jiraStatuses ? JSON.parse(jiraStatuses) : {},
				},
			}),
		} as ProjectConfig;
		const pmProvider = createPMProvider(pmProject);
		const prev = fn;
		fn = () => withPMProvider(pmProvider, prev);

		await fn();
	}
}

import { execFileSync } from 'node:child_process';

import { Command } from '@oclif/core';
import { withGitHubToken } from '../github/client.js';
import { withJiraCredentials } from '../jira/client.js';
import { withLinearCredentials } from '../linear/client.js';
import { createPMProvider, withPMProvider } from '../pm/index.js';
import type { PMType } from '../pm/types.js';
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

/**
 * Wrap `fn` in every credential scope whose env vars are set: GitHub token,
 * Trello, JIRA, Linear. Each scope is a no-op when its env vars aren't set.
 */
function wrapWithCredentialScopes(fn: () => Promise<void>): () => Promise<void> {
	const githubToken = process.env.GITHUB_TOKEN;
	if (githubToken) {
		const prev = fn;
		fn = () => withGitHubToken(githubToken, prev);
	}
	const trelloApiKey = process.env.TRELLO_API_KEY;
	const trelloToken = process.env.TRELLO_TOKEN;
	if (trelloApiKey && trelloToken) {
		const prev = fn;
		fn = () => withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, prev);
	}
	const jiraEmail = process.env.JIRA_EMAIL;
	const jiraApiToken = process.env.JIRA_API_TOKEN;
	const jiraBaseUrl = process.env.JIRA_BASE_URL;
	if (jiraEmail && jiraApiToken && jiraBaseUrl) {
		const prev = fn;
		fn = () =>
			withJiraCredentials({ email: jiraEmail, apiToken: jiraApiToken, baseUrl: jiraBaseUrl }, prev);
	}
	const linearApiKey = process.env.LINEAR_API_KEY;
	if (linearApiKey) {
		const prev = fn;
		fn = () => withLinearCredentials({ apiKey: linearApiKey }, prev);
	}
	return fn;
}

/**
 * Resolve `pmType` — prefer explicit `CASCADE_PM_TYPE`, fall back to
 * credential-based inference. JIRA wins over Linear when both are present
 * (matches the historical caller order).
 */
function resolvePmType(): PMType {
	const explicit = process.env.CASCADE_PM_TYPE as PMType | undefined;
	if (explicit) return explicit;
	if (process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN && process.env.JIRA_BASE_URL) {
		return 'jira';
	}
	if (process.env.LINEAR_API_KEY) return 'linear';
	return 'trello';
}

/**
 * Synthesize a minimal ProjectConfig shell from `CASCADE_*` env vars so
 * `createPMProvider` can construct the in-scope provider. Worker-spawned CLI
 * commands receive these env vars from `secretBuilder.augmentProjectSecrets`.
 */
function synthesizeProjectFromEnv(pmType: PMType): ProjectConfig {
	if (pmType === 'jira') {
		const jiraStatuses = process.env.CASCADE_JIRA_STATUSES;
		return {
			pm: { type: 'jira' },
			jira: {
				projectKey: process.env.CASCADE_JIRA_PROJECT_KEY ?? '',
				baseUrl: process.env.JIRA_BASE_URL as string,
				statuses: jiraStatuses ? JSON.parse(jiraStatuses) : {},
			},
		} as ProjectConfig;
	}
	if (pmType === 'linear') {
		const linearProjectId = process.env.CASCADE_LINEAR_PROJECT_ID;
		const linearStatuses = process.env.CASCADE_LINEAR_STATUSES;
		return {
			pm: { type: 'linear' },
			linear: {
				teamId: process.env.CASCADE_LINEAR_TEAM_ID ?? '',
				...(linearProjectId && { projectId: linearProjectId }),
				statuses: linearStatuses ? JSON.parse(linearStatuses) : {},
			},
		} as ProjectConfig;
	}
	return { pm: { type: 'trello' } } as ProjectConfig;
}

export abstract class CredentialScopedCommand extends Command {
	/** Subclasses implement this instead of run() */
	abstract execute(): Promise<void>;

	async run(): Promise<void> {
		let fn: () => Promise<void> = () => this.execute();
		fn = wrapWithCredentialScopes(fn);

		const pmProject = synthesizeProjectFromEnv(resolvePmType());
		const pmProvider = createPMProvider(pmProject);
		const prev = fn;
		fn = () => withPMProvider(pmProvider, prev);

		await fn();
	}
}

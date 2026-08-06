import { execFileSync } from 'node:child_process';

import { Command } from '@oclif/core';
import { withGitHubToken } from '../github/client.js';
import { withGitLabToken } from '../gitlab/client.js';
import { normalizeJiraAuthType } from '../jira/authType.js';
import { withJiraCredentials } from '../jira/client.js';
import { withLinearCredentials } from '../linear/client.js';
import { createPMProvider, withPMProvider } from '../pm/index.js';
import type { PMType } from '../pm/types.js';
import { withTrelloCredentials } from '../trello/client.js';
import type { ProjectConfig } from '../types/index.js';

export function resolveJiraBaseUrl(): string | undefined {
	return process.env.JIRA_BASE_URL || process.env.CASCADE_JIRA_BASE_URL;
}

/**
 * Detect the active SCM provider based on environment variables.
 * Checks CASCADE_SCM_PROVIDER (explicit, set by router) first,
 * then falls back to credential inference.
 */
export function detectSCMProvider(): 'github' | 'gitlab' {
	const explicit = process.env.CASCADE_SCM_PROVIDER;
	if (explicit === 'gitlab') return 'gitlab';
	if (explicit === 'github') return 'github';
	if (process.env.GITLAB_TOKEN_IMPLEMENTER) return 'gitlab';
	return 'github';
}

/**
 * Resolve repository owner/repo from flags, env vars, or git remote (in that order).
 * Supports both GitHub (owner/repo) and GitLab (group/subgroup/repo) patterns.
 */
export function resolveOwnerRepo(
	flagOwner?: string,
	flagRepo?: string,
): { owner: string; repo: string } {
	if (flagOwner && flagRepo) return { owner: flagOwner, repo: flagRepo };

	const envOwner = process.env.CASCADE_REPO_OWNER;
	const envRepo = process.env.CASCADE_REPO_NAME;
	if (envOwner && envRepo) return { owner: envOwner, repo: envRepo };

	// Fallback: detect from git remote
	const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf-8' }).trim();

	// Try GitLab pattern first (gitlab.com or custom host)
	const gitlabMatch = url.match(/gitlab[^/]*[/:](.+?)\/([^/]+?)(?:\.git)?$/);
	if (gitlabMatch) return { owner: gitlabMatch[1], repo: gitlabMatch[2] };

	// GitHub pattern
	const match = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
	if (!match) throw new Error(`Cannot detect owner/repo from git remote: ${url}`);
	return { owner: match[1], repo: match[2] };
}

/**
 * Wrap `fn` in every credential scope whose env vars are set: GitHub token,
 * GitLab token, Trello, JIRA, Linear. Each scope is a no-op when its env vars
 * aren't set.
 */
function wrapWithCredentialScopes(fn: () => Promise<void>): () => Promise<void> {
	const githubToken = process.env.GITHUB_TOKEN;
	if (githubToken) {
		const prev = fn;
		fn = () => withGitHubToken(githubToken, prev);
	}
	const gitlabToken = process.env.GITLAB_TOKEN_IMPLEMENTER;
	if (gitlabToken) {
		const prev = fn;
		const host = process.env.GITLAB_HOST ?? 'https://gitlab.com';
		fn = () => withGitLabToken(gitlabToken, prev, host);
	}
	const trelloApiKey = process.env.TRELLO_API_KEY;
	const trelloToken = process.env.TRELLO_TOKEN;
	if (trelloApiKey && trelloToken) {
		const prev = fn;
		fn = () => withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, prev);
	}
	const jiraEmail = process.env.JIRA_EMAIL;
	const jiraApiToken = process.env.JIRA_API_TOKEN;
	const jiraBaseUrl = resolveJiraBaseUrl();
	if (jiraEmail && jiraApiToken && jiraBaseUrl) {
		const prev = fn;
		// Carry the injected JIRA auth mode into the credential scope so
		// in-worker JIRA calls choose the correct host. Absent/unknown ⇒ 'basic'.
		const jiraAuthType = normalizeJiraAuthType(process.env.CASCADE_JIRA_AUTH_TYPE);
		fn = () =>
			withJiraCredentials(
				{ email: jiraEmail, apiToken: jiraApiToken, baseUrl: jiraBaseUrl, authType: jiraAuthType },
				prev,
			);
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
	if (process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN && resolveJiraBaseUrl()) {
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
		const jiraBaseUrl = resolveJiraBaseUrl();
		return {
			pm: { type: 'jira' },
			jira: {
				projectKey: process.env.CASCADE_JIRA_PROJECT_KEY ?? '',
				baseUrl: jiraBaseUrl ?? '',
				authType: normalizeJiraAuthType(process.env.CASCADE_JIRA_AUTH_TYPE),
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
	const trelloLists = process.env.CASCADE_TRELLO_LISTS;
	const trelloLabels = process.env.CASCADE_TRELLO_LABELS;
	return {
		pm: { type: 'trello' },
		trello: {
			boardId: process.env.CASCADE_TRELLO_BOARD_ID ?? '',
			lists: trelloLists ? JSON.parse(trelloLists) : {},
			labels: trelloLabels ? JSON.parse(trelloLabels) : {},
		},
	} as ProjectConfig;
}

/**
 * Resolve the full project path from git remote for GitLab.
 * GitLab uses path_with_namespace (e.g. "group/subgroup/repo").
 */
export function resolveProjectPath(): string {
	const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf-8' }).trim();
	// SSH: git@gitlab.com:appsome/bdgt.git → appsome/bdgt
	const sshMatch = url.match(/@[^:]+:(.+?)(?:\.git)?$/);
	if (sshMatch) return sshMatch[1];
	// HTTPS: https://oauth2:token@gitlab.com/appsome/bdgt.git → appsome/bdgt
	// Match path after the host (after ://...host/)
	const httpsMatch = url.match(/https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
	if (httpsMatch) return httpsMatch[1];
	throw new Error(`Cannot detect project path from git remote: ${url}`);
}

export abstract class CredentialScopedCommand extends Command {
	/**
	 * Pin oclif strict mode (its documented default) for every cascade-tools
	 * command. Without strict, unknown flags slip past parse validation and
	 * reach the gadget body as positional args — silently bypassing the
	 * spec-014 `unknown-flag` envelope. Locking the default explicitly guards
	 * against future oclif behavior drift and makes the assumption visible.
	 */
	static override strict = true;

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

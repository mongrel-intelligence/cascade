import { execFileSync } from 'node:child_process';

import { Command } from '@oclif/core';
import { withGitHubToken } from '../github/client.js';
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
/**
 * Rebuild the project a `cascade-tools` command runs against from the worker's
 * environment. There is no DB path here, so a field `augmentProjectSecrets`
 * does not emit simply does not exist inside the worker.
 *
 * Exported so the round trip can be tested against the real projection on both
 * ends rather than a hand-built config on either.
 */
/**
 * Parse the routing discriminator out of its env var.
 *
 * Degrades to "no discriminator" on anything malformed rather than throwing:
 * this runs at the head of EVERY cascade-tools invocation, so a truncated or
 * hand-edited value must not take every command down with it.
 */
function parseJiraRouting(
	raw: string | undefined,
): { discriminator: { kind: 'label' | 'component'; value: string } } | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as { discriminator?: { kind?: string; value?: string } };
		const d = parsed?.discriminator;
		if (!d || (d.kind !== 'label' && d.kind !== 'component')) return undefined;
		if (typeof d.value !== 'string' || d.value.length === 0) return undefined;
		return { discriminator: { kind: d.kind, value: d.value } };
	} catch {
		return undefined;
	}
}

export function synthesizeProjectFromEnv(pmType: PMType): ProjectConfig {
	if (pmType === 'jira') {
		const jiraStatuses = process.env.CASCADE_JIRA_STATUSES;
		const jiraBaseUrl = resolveJiraBaseUrl();
		const routing = parseJiraRouting(process.env.CASCADE_JIRA_ROUTING);
		return {
			pm: { type: 'jira' },
			jira: {
				projectKey: process.env.CASCADE_JIRA_PROJECT_KEY ?? '',
				baseUrl: jiraBaseUrl ?? '',
				authType: normalizeJiraAuthType(process.env.CASCADE_JIRA_AUTH_TYPE),
				statuses: jiraStatuses ? JSON.parse(jiraStatuses) : {},
				// Spec 024. Without this the in-worker provider stamps nothing on
				// the work items an agent creates and scopes nothing on the ones it
				// lists — so on a shared board an agent's own issue matches no
				// discriminator and is handed to the key's DEFAULT project.
				...(routing ? { routing } : {}),
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

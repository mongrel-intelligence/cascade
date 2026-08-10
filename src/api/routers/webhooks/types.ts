/**
 * Shared types for webhook service modules.
 */

import type { JiraAuthType } from '../../../jira/authType.js';

export interface TrelloWebhook {
	id: string;
	description: string;
	idModel: string;
	callbackURL: string;
	active: boolean;
}

export interface GitHubWebhook {
	id: number;
	name: string;
	active: boolean;
	events: string[];
	config: { url?: string; content_type?: string };
}

export interface JiraWebhookInfo {
	id: number;
	name: string;
	url: string;
	events: string[];
	enabled: boolean;
}

export interface SentryWebhookInfo {
	url: string;
	webhookSecretSet: boolean;
	organizationSlug: string;
	projectSlug: string;
	note: string;
}

export interface LinearWebhookInfo {
	url: string;
	webhookSecretSet: boolean;
	note: string;
}

export interface ProjectContext {
	projectId: string;
	orgId: string;
	repo?: string;
	pmType: 'trello' | 'jira' | 'linear' | 'github-projects';
	boardId?: string;
	jiraBaseUrl?: string;
	/**
	 * JIRA authentication mode resolved from `jiraConfig?.authType` (non-secret
	 * connection setting, mirrors `jiraBaseUrl`). `'scoped'` routes REST v3 calls
	 * through the Atlassian gateway; `'basic'`/absent uses the site URL. Consumed
	 * by the shared `resolveJiraApiBaseUrl` host resolver in `webhooks/jira.ts`.
	 */
	jiraAuthType?: JiraAuthType;
	jiraProjectKey?: string;
	jiraLabels?: string[];
	trelloApiKey: string;
	trelloToken: string;
	githubToken: string;
	jiraEmail?: string;
	jiraApiToken?: string;
	webhookSecret?: string;
	/** GitHub Projects owner login (org or user) from the PM config. */
	githubProjectsOwner?: string;
	/** GitHub Projects owner type — programmatic webhooks require `'organization'`. */
	githubProjectsOwnerType?: 'user' | 'organization';
	/** GitHub Projects PM token (the `GITHUB_PROJECTS_TOKEN` credential) for org-hook management. */
	githubProjectsToken?: string;
	/**
	 * GitHub Projects webhook signing secret (the `GITHUB_PROJECTS_WEBHOOK_SECRET`
	 * credential). Used to sign the programmatically-created org webhook so the
	 * secret matches what the router verifies incoming `projects_v2_item` events
	 * against (`resolveWebhookSecret('github-projects')`). Distinct from
	 * `webhookSecret`, which is the SCM `github` role's `GITHUB_WEBHOOK_SECRET`.
	 */
	githubProjectsWebhookSecret?: string;
	sentryConfigured?: boolean;
	sentryOrganizationSlug?: string;
	sentryProjectSlug?: string;
	sentryWebhookSecretSet?: boolean;
	linearApiKey?: string;
	linearWebhookSecretSet?: boolean;
}

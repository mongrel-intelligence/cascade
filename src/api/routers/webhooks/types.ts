/**
 * Shared types for webhook service modules.
 */

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

export interface ProjectContext {
	projectId: string;
	orgId: string;
	repo?: string;
	pmType: 'trello' | 'jira';
	boardId?: string;
	jiraBaseUrl?: string;
	jiraProjectKey?: string;
	jiraLabels?: string[];
	trelloApiKey: string;
	trelloToken: string;
	githubToken: string;
	jiraEmail?: string;
	jiraApiToken?: string;
	webhookSecret?: string;
}

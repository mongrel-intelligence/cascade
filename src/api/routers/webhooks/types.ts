/**
 * Webhook payload types — one per platform.
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

/**
 * Shared project context passed to all webhook platform adapters.
 * Extracted from resolveProjectContext() in the webhooks router.
 */
export interface ProjectContext {
	projectId: string;
	orgId: string;
	repo: string;
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
}

/**
 * Generic webhook info type — union of all platform webhook types.
 */
export type AnyWebhookInfo = TrelloWebhook | GitHubWebhook | JiraWebhookInfo;

/**
 * WebhookPlatformAdapter — per-platform pluggable behavior for the webhook
 * management API (list, create, delete).
 *
 * Mirrors the `RouterPlatformAdapter` pattern from `src/router/platform-adapter.ts`
 * but for the dashboard-side webhook management API.
 */
export interface WebhookPlatformAdapter<T extends AnyWebhookInfo> {
	/** Platform identifier used in results and logs. */
	readonly type: 'trello' | 'github' | 'jira';

	/**
	 * List all webhooks for this platform that belong to the project.
	 * Returns an empty array when credentials are not configured.
	 */
	list(ctx: ProjectContext): Promise<T[]>;

	/**
	 * Create a webhook for the given callback URL.
	 * Returns either the created webhook or a "Already exists: <id>" string
	 * when a duplicate is detected. Returns undefined when credentials are
	 * not present or the platform is not applicable.
	 */
	create(ctx: ProjectContext, baseUrl: string): Promise<T | string | undefined>;

	/**
	 * Delete all webhooks matching the given callback URL.
	 * Returns the list of IDs/numbers deleted.
	 */
	delete(ctx: ProjectContext, baseUrl: string): Promise<Array<string | number>>;
}

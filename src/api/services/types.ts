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

export interface WebhookManager<T, ID> {
	list(): Promise<T[]>;
	create(callbackURL: string): Promise<T>;
	delete(id: ID): Promise<void>;
}

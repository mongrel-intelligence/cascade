import { Octokit } from '@octokit/rest';
import { parseRepoFullName } from '../../utils/repo.js';
import type { GitHubWebhook, WebhookManager } from './types.js';

export const GITHUB_WEBHOOK_EVENTS = [
	'pull_request',
	'pull_request_review',
	'check_suite',
	'issue_comment',
];

interface GitHubContext {
	githubToken: string;
	repo: string;
}

export class GitHubWebhookManager implements WebhookManager<GitHubWebhook, number> {
	private readonly octokit: Octokit;
	private readonly owner: string;
	private readonly repo: string;

	constructor(ctx: GitHubContext) {
		this.octokit = new Octokit({ auth: ctx.githubToken });
		const parsed = parseRepoFullName(ctx.repo);
		this.owner = parsed.owner;
		this.repo = parsed.repo;
	}

	async list(): Promise<GitHubWebhook[]> {
		const { data } = await this.octokit.repos.listWebhooks({
			owner: this.owner,
			repo: this.repo,
		});
		return data as GitHubWebhook[];
	}

	async create(callbackURL: string): Promise<GitHubWebhook> {
		const { data } = await this.octokit.repos.createWebhook({
			owner: this.owner,
			repo: this.repo,
			config: { url: callbackURL, content_type: 'json' },
			events: GITHUB_WEBHOOK_EVENTS,
			active: true,
		});
		return data as GitHubWebhook;
	}

	async delete(hookId: number): Promise<void> {
		await this.octokit.repos.deleteWebhook({
			owner: this.owner,
			repo: this.repo,
			hook_id: hookId,
		});
	}
}

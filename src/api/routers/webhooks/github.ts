import { Octokit } from '@octokit/rest';
import { parseRepoFullName } from '../../../utils/repo.js';
import type { GitHubWebhook, ProjectContext, WebhookPlatformAdapter } from './types.js';

const GITHUB_WEBHOOK_EVENTS = [
	'pull_request',
	'pull_request_review',
	'check_suite',
	'issue_comment',
];

async function githubListWebhooks(ctx: ProjectContext): Promise<GitHubWebhook[]> {
	if (!ctx.githubToken) return [];
	const octokit = new Octokit({ auth: ctx.githubToken });
	const { owner, repo } = parseRepoFullName(ctx.repo);
	const { data } = await octokit.repos.listWebhooks({ owner, repo });
	return data as GitHubWebhook[];
}

async function githubCreateWebhook(
	ctx: ProjectContext,
	callbackURL: string,
): Promise<GitHubWebhook> {
	const octokit = new Octokit({ auth: ctx.githubToken });
	const { owner, repo } = parseRepoFullName(ctx.repo);
	const { data } = await octokit.repos.createWebhook({
		owner,
		repo,
		config: { url: callbackURL, content_type: 'json' },
		events: GITHUB_WEBHOOK_EVENTS,
		active: true,
	});
	return data as GitHubWebhook;
}

async function githubDeleteWebhook(ctx: ProjectContext, hookId: number): Promise<void> {
	const octokit = new Octokit({ auth: ctx.githubToken });
	const { owner, repo } = parseRepoFullName(ctx.repo);
	await octokit.repos.deleteWebhook({ owner, repo, hook_id: hookId });
}

export class GitHubWebhookAdapter implements WebhookPlatformAdapter<GitHubWebhook> {
	readonly type = 'github' as const;

	async list(ctx: ProjectContext): Promise<GitHubWebhook[]> {
		return githubListWebhooks(ctx);
	}

	async create(ctx: ProjectContext, baseUrl: string): Promise<GitHubWebhook | string | undefined> {
		if (!ctx.githubToken) return undefined;

		const callbackUrl = `${baseUrl}/github/webhook`;
		const existing = await githubListWebhooks(ctx);
		const duplicate = existing.find(
			(w) => w.config.url === callbackUrl || w.config.url === `${baseUrl}/webhook/github`,
		);

		if (duplicate) {
			return `Already exists: ${duplicate.id}`;
		}
		return githubCreateWebhook(ctx, callbackUrl);
	}

	async delete(ctx: ProjectContext, baseUrl: string): Promise<number[]> {
		if (!ctx.githubToken) return [];

		const callbackUrl = `${baseUrl}/github/webhook`;
		const existing = await githubListWebhooks(ctx);
		const matching = existing.filter(
			(w) => w.config.url === callbackUrl || w.config.url === `${baseUrl}/webhook/github`,
		);
		const deleted: number[] = [];
		for (const w of matching) {
			await githubDeleteWebhook(ctx, w.id);
			deleted.push(w.id);
		}
		return deleted;
	}
}

import { Octokit } from '@octokit/rest';
import { parseRepoFullName } from '../../../utils/repo.js';
import type { GitHubWebhook, ProjectContext } from './types.js';

const GITHUB_WEBHOOK_EVENTS = [
	'pull_request',
	'pull_request_review',
	'check_suite',
	'issue_comment',
];

export async function githubListWebhooks(ctx: ProjectContext): Promise<GitHubWebhook[]> {
	if (!ctx.githubToken) return [];
	const octokit = new Octokit({ auth: ctx.githubToken });
	const { owner, repo } = parseRepoFullName(ctx.repo);
	const { data } = await octokit.repos.listWebhooks({ owner, repo });
	return data as GitHubWebhook[];
}

export async function githubCreateWebhook(
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

export async function githubDeleteWebhook(ctx: ProjectContext, hookId: number): Promise<void> {
	const octokit = new Octokit({ auth: ctx.githubToken });
	const { owner, repo } = parseRepoFullName(ctx.repo);
	await octokit.repos.deleteWebhook({ owner, repo, hook_id: hookId });
}

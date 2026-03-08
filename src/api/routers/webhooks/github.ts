import { Octokit } from '@octokit/rest';
import { logger } from '../../../utils/logging.js';
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
	if (!ctx.repo) return []; // No repo configured
	const octokit = new Octokit({ auth: ctx.githubToken });
	const { owner, repo } = parseRepoFullName(ctx.repo);
	const { data } = await octokit.repos.listWebhooks({ owner, repo });
	return data as GitHubWebhook[];
}

export async function githubCreateWebhook(
	ctx: ProjectContext,
	callbackURL: string,
): Promise<GitHubWebhook> {
	if (!ctx.repo) {
		throw new Error('Cannot create GitHub webhook: no repo configured for this project');
	}
	const octokit = new Octokit({ auth: ctx.githubToken });
	const { owner, repo } = parseRepoFullName(ctx.repo);

	// Delete any existing webhooks with the same callback URL to prevent duplicates.
	// Unlike Trello, GitHub repos can have webhooks from other integrations, so we
	// only delete webhooks matching our specific callback URL.
	const existingWebhooks = await githubListWebhooks(ctx);
	for (const webhook of existingWebhooks) {
		if (webhook.config?.url === callbackURL) {
			try {
				await githubDeleteWebhook(ctx, webhook.id);
				logger.info('[GitHubWebhook] Deleted existing webhook to prevent duplicates', {
					webhookId: webhook.id,
					projectId: ctx.projectId,
					repo: ctx.repo,
				});
			} catch (err) {
				// Log and continue — failing to delete shouldn't prevent creating a new one
				logger.warn('[GitHubWebhook] Failed to delete existing webhook (continuing)', {
					webhookId: webhook.id,
					projectId: ctx.projectId,
					error: String(err),
				});
			}
		}
	}

	// Now create the new webhook
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
	if (!ctx.repo) {
		throw new Error('Cannot delete GitHub webhook: no repo configured for this project');
	}
	const octokit = new Octokit({ auth: ctx.githubToken });
	const { owner, repo } = parseRepoFullName(ctx.repo);
	await octokit.repos.deleteWebhook({ owner, repo, hook_id: hookId });
}
